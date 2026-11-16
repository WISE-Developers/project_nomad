/**
 * #546 — `/results/:id/preview` has no outputType branch.
 *
 * The route reads `stored.result.metadata.filePath` and calls `generateContours`
 * unconditionally. `generateContours(filePath)` takes nothing but a path and applies
 * the static FireSTARR probability SLD symbology, so the two non-probability products
 * #536 now persists are handled as if they were burn-probability rasters:
 *
 *   - a PERIMETER row carries its geometry in the row and has no file, so preview
 *     throws NotFoundError('Result file') — a 404 for a row that exists;
 *   - an ARRIVAL_TIME row has a real .tif path, so preview contours it and returns
 *     200 with probability bands over Julian-day values. That one does not fail. It
 *     answers, which is worse: nothing downstream can tell the result from a real
 *     probability preview.
 *
 * `download` already resolves both products (#292, then #536). Preview never learned.
 *
 * SCOPE, measured rather than assumed: the GUI does not reach this today. The
 * row-mapped outputs in ModelResultsService filter out `perimeter` and `arrival_time`
 * (its `derivedRowTypes`), and the derived OutputItems carry their own previewUrls —
 * `/models/:id/arrival-tile/{z}/{x}/{y}.png` and `/models/:id/perimeters?day=N`. So
 * `/api/v1/results/:id/preview` is only ever handed one of these ids by a caller that
 * reads result rows directly, which is every MCP caller and anything holding a
 * download id. A documented endpoint answering wrongly for ids that exist is still a
 * defect; it is not a GUI regression.
 *
 * These tests assert observable HTTP behavior, like the #536 ones they sit beside.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Readable } from 'stream';

const {
  getResultById,
  getPerimeterGeoJSON,
  getArrivalRasterPath,
  getModelResultsService,
  generateContours,
} = vi.hoisted(() => {
  const getResultById = vi.fn();
  const getPerimeterGeoJSON = vi.fn();
  const getArrivalRasterPath = vi.fn();
  const generateContours = vi.fn();
  const getModelResultsService = vi.fn((_engine?: unknown) => ({
    getResultById,
    getPerimeterGeoJSON,
    getArrivalRasterPath,
  }));
  return {
    getResultById,
    getPerimeterGeoJSON,
    getArrivalRasterPath,
    getModelResultsService,
    generateContours,
  };
});

vi.mock('../../../../application/services/index.js', () => ({
  getModelResultsService,
}));

vi.mock('../../../../infrastructure/firestarr/index.js', () => ({
  getFireSTARREngine: vi.fn(() => ({ __engine: 'firestarr-stub' })),
  generateContours,
  generateRasterTile: vi.fn(),
  getRasterBounds: vi.fn(),
  ContourError: class ContourError extends Error {},
}));

vi.mock('../../../../infrastructure/firestarr/FireSTARRInputGenerator.js', () => ({
  resolveResultFilePath: vi.fn((p: string) => `/sims/${p}`),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  createReadStream: vi.fn(() => Readable.from(Buffer.from('FAKE_GEOTIFF_BYTES'))),
}));
vi.mock('fs/promises', () => ({
  stat: vi.fn(async () => ({ size: 18 })),
}));

import resultsRouter from '../results.js';
import { errorHandler } from '../../../middleware/errorHandler.js';
import { serveOnce } from '../../../../test/sharedServer.js';

function buildApp() {
  const app = express();
  app.use('/api/v1', resultsRouter);
  app.use(errorHandler);
  return app;
}
const api = serveOnce(buildApp);

const PERIMETER_ID = 'perimeter-day170-model-abc';
const ARRIVAL_ID = 'arrival-time-model-abc';
const PROBABILITY_ID = 'result-probability-001';

const PERIMETER_GEOJSON = {
  type: 'Feature' as const,
  properties: { julianDay: 170 },
  geometry: {
    type: 'Polygon' as const,
    coordinates: [[[-114, 60], [-113.9, 60], [-113.9, 60.1], [-114, 60.1], [-114, 60]]],
  },
};

const CONTOURS = { type: 'FeatureCollection' as const, features: [{ __contour: true }] };

beforeEach(() => {
  getResultById.mockReset();
  getPerimeterGeoJSON.mockReset();
  getArrivalRasterPath.mockReset();
  generateContours.mockReset();
  getModelResultsService.mockClear();
  getPerimeterGeoJSON.mockResolvedValue(undefined);
  getArrivalRasterPath.mockResolvedValue(undefined);
  generateContours.mockResolvedValue(CONTOURS);
});

describe('#546 — preview branches on outputType', () => {
  it('CONTROL: a probability row is still contoured, unchanged', async () => {
    // The case that works today. Without it, a change that broke probability
    // previews entirely would satisfy every other test in this file.
    getResultById.mockResolvedValue({
      modelId: 'model-abc',
      result: {
        id: PROBABILITY_ID,
        outputType: 'probability',
        format: 'geotiff',
        metadata: { filePath: 'model-abc/probability_100_2026-06-19.tif' },
      },
    });

    const res = await request(api()).get(`/api/v1/results/${PROBABILITY_ID}/preview`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('geo+json');
    expect(JSON.parse(res.text)).toEqual(CONTOURS);
    expect(generateContours).toHaveBeenCalledWith('/sims/model-abc/probability_100_2026-06-19.tif');
  });

  it('serves a persisted perimeter row as GeoJSON instead of 404ing on its missing file', async () => {
    getResultById.mockResolvedValue({
      modelId: 'model-abc',
      result: {
        id: PERIMETER_ID,
        outputType: 'perimeter',
        format: 'geojson',
        metadata: { julianDay: 170, deterministic: true, geojson: PERIMETER_GEOJSON },
      },
    });

    const res = await request(api()).get(`/api/v1/results/${PERIMETER_ID}/preview`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('geo+json');
    expect(JSON.parse(res.text)).toEqual(PERIMETER_GEOJSON);
    expect(generateContours).not.toHaveBeenCalled();
  });

  it('regenerates a perimeter on demand when the row carries no geometry', async () => {
    getResultById.mockResolvedValue({
      modelId: 'model-abc',
      result: {
        id: PERIMETER_ID,
        outputType: 'perimeter',
        format: 'geojson',
        metadata: { julianDay: 170, deterministic: true },
      },
    });
    getPerimeterGeoJSON.mockResolvedValue(JSON.stringify(PERIMETER_GEOJSON));

    const res = await request(api()).get(`/api/v1/results/${PERIMETER_ID}/preview`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('geo+json');
    expect(JSON.parse(res.text)).toEqual(PERIMETER_GEOJSON);
    expect(generateContours).not.toHaveBeenCalled();
  });

  it('serves a never-persisted (synthetic) perimeter id, as download already does', async () => {
    getResultById.mockResolvedValue(undefined);
    getPerimeterGeoJSON.mockResolvedValue(JSON.stringify(PERIMETER_GEOJSON));

    const res = await request(api()).get(`/api/v1/results/${PERIMETER_ID}/preview`);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toEqual(PERIMETER_GEOJSON);
  });

  it('REFUSES an arrival-time row rather than contouring Julian days as probability', async () => {
    // The sharp one. Today this returns 200 with probability bands over day
    // numbers — a wrong answer dressed as a right one. There is no GeoJSON
    // representation of an arrival grid to serve instead, and generateContours
    // takes no symbology argument, so the honest response is a refusal that
    // names the endpoint which CAN render it.
    getResultById.mockResolvedValue({
      modelId: 'model-abc',
      result: {
        id: ARRIVAL_ID,
        outputType: 'arrival_time',
        format: 'geotiff',
        metadata: { filePath: 'model-abc/000_001_170_arrival.tif' },
      },
    });

    const res = await request(api()).get(`/api/v1/results/${ARRIVAL_ID}/preview`);

    expect(res.status).toBe(400);
    expect(generateContours).not.toHaveBeenCalled();
    expect(res.text).toContain('arrival-tile');
  });

  it('REFUSES a synthetic arrival-time id for the same reason', async () => {
    getResultById.mockResolvedValue(undefined);
    getArrivalRasterPath.mockResolvedValue('/sims/model-abc/000_001_170_arrival.tif');

    const res = await request(api()).get(`/api/v1/results/${ARRIVAL_ID}/preview`);

    expect(res.status).toBe(400);
    expect(generateContours).not.toHaveBeenCalled();
    expect(res.text).toContain('arrival-tile');
  });

  it('still 404s an id that resolves to nothing at all', async () => {
    getResultById.mockResolvedValue(undefined);

    const res = await request(api()).get('/api/v1/results/no-such-result/preview');

    expect(res.status).toBe(404);
  });
});
