/**
 * #550 — `tile` and `bounds` are the last two members of the class #546 fixed.
 *
 * Four routes in `results.ts` open the same way: look the row up, read
 * `metadata.filePath`, hand the path to a renderer written for probability rasters.
 * `download` grew its branches in #292 and #536; `preview` got them in #546. These two
 * never did, and since #536 persists perimeter and arrival-time rows, both are reachable
 * with ids that exist.
 *
 * WHAT IS WRONG, PER ROUTE AND PER TYPE — the point of this file is that it is not one
 * rule for both:
 *
 *   - `tile` on an ARRIVAL row: the `.tif` resolves, so the probability colour table is
 *     applied to Julian-day values. A 200 and a plausible PNG of the wrong quantity.
 *     `/models/:id/arrival-tile/{z}/{x}/{y}.png` is the renderer that classifies arrival
 *     values correctly.
 *   - `tile` on a PERIMETER row: no file, so a 404 for a row that exists. A perimeter is
 *     a vector; there is no raster to tile, so the honest answer is a refusal naming the
 *     routes that CAN serve it, not a 404 that says the thing is missing.
 *   - `bounds` on a PERIMETER row: a 404 while the geometry sits in the row. Its bounding
 *     box is computable directly, and `BoundingBox.fromCoordinates` already does it.
 *   - `bounds` on an ARRIVAL row: **CORRECT TODAY AND MUST STAY THAT WAY.** Extent does
 *     not depend on what the pixel values mean. It is asserted below as a control, so a
 *     later "fix" for symmetry fails loudly.
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
  generateRasterTile,
  getRasterBounds,
  generateContours,
} = vi.hoisted(() => {
  const getResultById = vi.fn();
  const getPerimeterGeoJSON = vi.fn();
  const getArrivalRasterPath = vi.fn();
  const generateRasterTile = vi.fn();
  const getRasterBounds = vi.fn();
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
    generateRasterTile,
    getRasterBounds,
    generateContours,
  };
});

vi.mock('../../../../application/services/index.js', () => ({
  getModelResultsService,
}));

vi.mock('../../../../infrastructure/firestarr/index.js', () => ({
  getFireSTARREngine: vi.fn(() => ({ __engine: 'firestarr-stub' })),
  generateContours,
  generateRasterTile,
  getRasterBounds,
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

const RASTER_BOUNDS: [number, number, number, number] = [-116, 60, -115, 61];

/** A two-lobed perimeter with a hole, so the bbox has to span both lobes. */
const PERIMETER_GEOJSON = {
  type: 'Feature' as const,
  properties: { julianDay: 170 },
  geometry: {
    type: 'MultiPolygon' as const,
    coordinates: [
      [
        [
          [-115.8, 60.7],
          [-115.8, 60.9],
          [-115.6, 60.9],
          [-115.6, 60.7],
          [-115.8, 60.7],
        ],
        [
          [-115.75, 60.75],
          [-115.75, 60.8],
          [-115.7, 60.8],
          [-115.75, 60.75],
        ],
      ],
      [
        [
          [-115.5, 60.5],
          [-115.5, 60.51],
          [-115.49, 60.51],
          [-115.5, 60.5],
        ],
      ],
    ],
  },
};

/** The bbox of the geometry above: both lobes, holes irrelevant to extent. */
const PERIMETER_BBOX = [-115.8, 60.5, -115.49, 60.9];

function probabilityRow() {
  return {
    modelId: 'model-abc',
    result: {
      id: PROBABILITY_ID,
      outputType: 'probability',
      format: 'geotiff',
      metadata: { filePath: 'model-abc/probability_100_2026-06-19.tif' },
    },
  };
}

function arrivalRow() {
  return {
    modelId: 'model-abc',
    result: {
      id: ARRIVAL_ID,
      outputType: 'arrival_time',
      format: 'geotiff',
      metadata: { filePath: 'model-abc/000_001_170_arrival.tif' },
    },
  };
}

function perimeterRow(withGeometry = true) {
  return {
    modelId: 'model-abc',
    result: {
      id: PERIMETER_ID,
      outputType: 'perimeter',
      format: 'geojson',
      metadata: withGeometry
        ? { julianDay: 170, deterministic: true, geojson: PERIMETER_GEOJSON }
        : { julianDay: 170, deterministic: true },
    },
  };
}

beforeEach(() => {
  getResultById.mockReset();
  getPerimeterGeoJSON.mockReset();
  getArrivalRasterPath.mockReset();
  generateRasterTile.mockReset();
  getRasterBounds.mockReset();
  generateContours.mockReset();
  getModelResultsService.mockClear();
  getPerimeterGeoJSON.mockResolvedValue(undefined);
  getArrivalRasterPath.mockResolvedValue(undefined);
  generateRasterTile.mockResolvedValue(Buffer.from('FAKE_PNG'));
  getRasterBounds.mockResolvedValue(RASTER_BOUNDS);
});

describe('#550 — tile branches on outputType', () => {
  it('CONTROL: a probability row is still tiled, unchanged', () => {
    getResultById.mockResolvedValue(probabilityRow());

    return request(api())
      .get(`/api/v1/results/${PROBABILITY_ID}/tile/8/120/80.png`)
      .then((res) => {
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('image/png');
        expect(generateRasterTile).toHaveBeenCalled();
      });
  });

  it('REFUSES an arrival row rather than colouring Julian days as probability', async () => {
    getResultById.mockResolvedValue(arrivalRow());

    const res = await request(api()).get(`/api/v1/results/${ARRIVAL_ID}/tile/8/120/80.png`);

    expect(res.status).toBe(400);
    expect(generateRasterTile).not.toHaveBeenCalled();
    expect(res.text).toContain('arrival-tile');
  });

  it('REFUSES a perimeter row with a reason, instead of 404ing a row that exists', async () => {
    getResultById.mockResolvedValue(perimeterRow());

    const res = await request(api()).get(`/api/v1/results/${PERIMETER_ID}/tile/8/120/80.png`);

    expect(res.status).toBe(400);
    expect(generateRasterTile).not.toHaveBeenCalled();
    expect(res.text).toMatch(/preview|download/);
  });

  it('REFUSES a synthetic arrival id for the same reason as a row', async () => {
    getResultById.mockResolvedValue(undefined);
    getArrivalRasterPath.mockResolvedValue('/sims/model-abc/000_001_170_arrival.tif');

    const res = await request(api()).get(`/api/v1/results/${ARRIVAL_ID}/tile/8/120/80.png`);

    expect(res.status).toBe(400);
    expect(generateRasterTile).not.toHaveBeenCalled();
  });

  it('still 404s an id that resolves to nothing at all', async () => {
    getResultById.mockResolvedValue(undefined);

    const res = await request(api()).get('/api/v1/results/no-such-result/tile/8/120/80.png');

    expect(res.status).toBe(404);
  });
});

describe('#550 — bounds answers from whatever the product actually is', () => {
  it('CONTROL: a probability row still reads bounds off the raster', async () => {
    getResultById.mockResolvedValue(probabilityRow());

    const res = await request(api()).get(`/api/v1/results/${PROBABILITY_ID}/bounds`);

    expect(res.status).toBe(200);
    expect(res.body.bounds).toEqual(RASTER_BOUNDS);
    expect(getRasterBounds).toHaveBeenCalledWith('/sims/model-abc/probability_100_2026-06-19.tif');
  });

  it('CONTROL: an ARRIVAL row still reads bounds off the raster — this one was never wrong', async () => {
    // The combination that must NOT be "fixed". Extent is independent of what the
    // pixel values mean, so the existing path is correct and stays.
    getResultById.mockResolvedValue(arrivalRow());

    const res = await request(api()).get(`/api/v1/results/${ARRIVAL_ID}/bounds`);

    expect(res.status).toBe(200);
    expect(res.body.bounds).toEqual(RASTER_BOUNDS);
    expect(getRasterBounds).toHaveBeenCalledWith('/sims/model-abc/000_001_170_arrival.tif');
  });

  it('computes a perimeter row bounds from the geometry in the row', async () => {
    getResultById.mockResolvedValue(perimeterRow());

    const res = await request(api()).get(`/api/v1/results/${PERIMETER_ID}/bounds`);

    expect(res.status).toBe(200);
    expect(res.body.bounds).toEqual(PERIMETER_BBOX);
    expect(getRasterBounds).not.toHaveBeenCalled();
  });

  it('spans BOTH lobes of a multi-part perimeter, not just the first', async () => {
    // The failure this guards: walking coordinates[0] only, which is how a MultiPolygon
    // got read as "1 vertex" in #536's probe. The second lobe is further south and east
    // than the first, so a first-part-only bbox cannot produce this answer.
    getResultById.mockResolvedValue(perimeterRow());

    const res = await request(api()).get(`/api/v1/results/${PERIMETER_ID}/bounds`);

    expect(res.body.bounds[1], 'south must come from lobe 2').toBeCloseTo(60.5, 6);
    expect(res.body.bounds[2], 'east must come from lobe 2').toBeCloseTo(-115.49, 6);
  });

  it('regenerates a perimeter on demand when the row carries no geometry', async () => {
    getResultById.mockResolvedValue(perimeterRow(false));
    getPerimeterGeoJSON.mockResolvedValue(JSON.stringify(PERIMETER_GEOJSON));

    const res = await request(api()).get(`/api/v1/results/${PERIMETER_ID}/bounds`);

    expect(res.status).toBe(200);
    expect(res.body.bounds).toEqual(PERIMETER_BBOX);
  });

  it('serves a never-persisted (synthetic) perimeter id too', async () => {
    getResultById.mockResolvedValue(undefined);
    getPerimeterGeoJSON.mockResolvedValue(JSON.stringify(PERIMETER_GEOJSON));

    const res = await request(api()).get(`/api/v1/results/${PERIMETER_ID}/bounds`);

    expect(res.status).toBe(200);
    expect(res.body.bounds).toEqual(PERIMETER_BBOX);
  });

  it('still 404s an id that resolves to nothing at all', async () => {
    getResultById.mockResolvedValue(undefined);

    const res = await request(api()).get('/api/v1/results/no-such-result/bounds');

    expect(res.status).toBe(404);
  });
});
