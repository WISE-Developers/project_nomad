/**
 * #536 — downloading a perimeter or arrival-time product that IS now a result row.
 *
 * #536 makes the deterministic perimeter and arrival-time products persist as
 * result rows so MCP can retrieve them. That invalidates the premise the #292
 * regression test is built on, stated in its own setup: "Synthetic outputs are
 * never persisted -> the repo lookup is always null."
 *
 * Once a row exists under the SAME id the download route resolves synthetically,
 * `getResultById` starts returning it, the route takes the stored-row branch, and
 * that branch reads `stored.result.metadata.filePath`. A perimeter row has no
 * filePath — its geometry travels in the row — so the route threw
 * NotFoundError('Result file') and #292 came back for every model whose rows had
 * been persisted.
 *
 * The whole backend suite stayed green through that regression, because no test
 * exercised a download for a perimeter whose row EXISTS. A green suite is not a
 * working build, and the silence of 1600 tests was silence about a state none of
 * them created.
 *
 * These tests assert observable HTTP behavior, like the #292 ones they sit beside.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Readable } from 'stream';

const { getResultById, getPerimeterGeoJSON, getArrivalRasterPath, getModelResultsService } =
  vi.hoisted(() => {
    const getResultById = vi.fn();
    const getPerimeterGeoJSON = vi.fn();
    const getArrivalRasterPath = vi.fn();
    const getModelResultsService = vi.fn((_engine?: unknown) => ({
      getResultById,
      getPerimeterGeoJSON,
      getArrivalRasterPath,
    }));
    return { getResultById, getPerimeterGeoJSON, getArrivalRasterPath, getModelResultsService };
  });

vi.mock('../../../../application/services/index.js', () => ({
  getModelResultsService,
}));

vi.mock('../../../../infrastructure/firestarr/index.js', () => ({
  getFireSTARREngine: vi.fn(() => ({ __engine: 'firestarr-stub' })),
  generateContours: vi.fn(),
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

const PERIMETER_GEOJSON = {
  type: 'Feature' as const,
  properties: {},
  geometry: {
    type: 'Polygon' as const,
    coordinates: [[[-114, 60], [-113.9, 60], [-113.9, 60.1], [-114, 60.1], [-114, 60]]],
  },
};

beforeEach(() => {
  getResultById.mockReset();
  getPerimeterGeoJSON.mockReset();
  getArrivalRasterPath.mockReset();
  getModelResultsService.mockClear();
  getPerimeterGeoJSON.mockResolvedValue(undefined);
  getArrivalRasterPath.mockResolvedValue(undefined);
});

describe('#536 — a PERSISTED perimeter row is still downloadable', () => {
  it('serves the row GeoJSON when the row exists and has no filePath', async () => {
    // The row #536 writes: geometry in metadata, no filePath.
    getResultById.mockResolvedValue({
      modelId: 'model-abc',
      result: {
        id: PERIMETER_ID,
        outputType: 'perimeter',
        format: 'geojson',
        metadata: { julianDay: 170, deterministic: true, geojson: PERIMETER_GEOJSON },
      },
    });

    const res = await request(api()).get(`/api/v1/results/${PERIMETER_ID}/download`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('geo+json');
    expect(JSON.parse(res.text)).toEqual(PERIMETER_GEOJSON);
  });

  it('falls back to on-demand regeneration when the row carries no geometry either', async () => {
    // Defence in depth: a row written by an older build, or one whose geometry
    // did not survive the repository, must not 404 while the arrival rasters
    // that produced it are still on disk.
    const regenerated = JSON.stringify({ type: 'FeatureCollection', features: [] });
    getResultById.mockResolvedValue({
      modelId: 'model-abc',
      result: {
        id: PERIMETER_ID,
        outputType: 'perimeter',
        format: 'geojson',
        metadata: { julianDay: 170, deterministic: true },
      },
    });
    getPerimeterGeoJSON.mockResolvedValue(regenerated);

    const res = await request(api()).get(`/api/v1/results/${PERIMETER_ID}/download`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('geo+json');
    expect(res.text).toBe(regenerated);
  });
});

describe('#536 — a PERSISTED arrival-time row is still downloadable', () => {
  it('streams the GeoTIFF from the row relative filePath', async () => {
    // #536 stores this path RELATIVE (`modelId/filename`), matching every
    // probability row, so resolveResultFilePath resolves it correctly.
    getResultById.mockResolvedValue({
      modelId: 'model-abc',
      result: {
        id: ARRIVAL_ID,
        outputType: 'arrival_time',
        format: 'geotiff',
        metadata: { filePath: 'model-abc/000_000001_172_arrival.tif', deterministic: true },
      },
    });

    const res = await request(api()).get(`/api/v1/results/${ARRIVAL_ID}/download`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('tiff');
    expect(res.headers['content-disposition']).toContain('attachment');
  });
});

describe('#536 — the genuinely missing case is unchanged', () => {
  it('still returns 404 for a row that exists, has no file, and resolves to nothing', async () => {
    // THE DISCRIMINATOR: proves the new branch is a real resolution and not a
    // blanket 200. A probability row with no filePath and nothing to fall back
    // on must still 404.
    getResultById.mockResolvedValue({
      modelId: 'model-abc',
      result: {
        id: 'res-broken',
        outputType: 'probability',
        format: 'geotiff',
        metadata: {},
      },
    });

    const res = await request(api()).get('/api/v1/results/res-broken/download');

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});
