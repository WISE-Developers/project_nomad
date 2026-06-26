/**
 * Regression tests for bug #292 — "Can't download fire perimeters" (and the
 * sibling arrival-time raster).
 *
 * Deterministic perimeters AND the arrival-time raster are SYNTHETIC outputs:
 * getResults() surfaces them with ids `perimeter-day{julianDay}-{modelId}` and
 * `arrival-time-{modelId}`, but neither is persisted as a result row. The
 * display paths work (they regenerate / tile on demand); the download path,
 * GET /results/:resultId/download, resolved via getResultById() -> repo and
 * threw NotFoundError -> "Result not found: ..." (404). Both are the bug.
 *
 * Fix (Option 1): when the repo has no row, regenerate the perimeter GeoJSON, or
 * stream the arrival-time GeoTIFF, the same way the display paths source them.
 *
 * Tests assert OBSERVABLE HTTP behavior so they survive the implementation.
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

// Keep importing the route inert (no GDAL/native engine work).
vi.mock('../../../../infrastructure/firestarr/index.js', () => ({
  getFireSTARREngine: vi.fn(() => ({ __engine: 'firestarr-stub' })),
  generateContours: vi.fn(),
  generateRasterTile: vi.fn(),
  getRasterBounds: vi.fn(),
  ContourError: class ContourError extends Error {},
}));

vi.mock('../../../../infrastructure/firestarr/FireSTARRInputGenerator.js', () => ({
  resolveResultFilePath: vi.fn((p: string) => p),
}));

// Filesystem is mocked so the arrival-raster stream path is exercised without disk I/O.
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  createReadStream: vi.fn(() => Readable.from(Buffer.from('FAKE_GEOTIFF_BYTES'))),
}));
vi.mock('fs/promises', () => ({
  stat: vi.fn(async () => ({ size: 18 })),
}));

import resultsRouter from '../results.js';
import { errorHandler } from '../../../middleware/errorHandler.js';

function buildApp() {
  const app = express();
  app.use('/api/v1', resultsRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  getResultById.mockReset();
  getPerimeterGeoJSON.mockReset();
  getArrivalRasterPath.mockReset();
  getModelResultsService.mockClear();
  // Synthetic outputs are never persisted -> the repo lookup is always null.
  getResultById.mockResolvedValue(null);
  getPerimeterGeoJSON.mockResolvedValue(undefined);
  getArrivalRasterPath.mockResolvedValue(undefined);
});

describe('/results/:id/download — synthetic perimeter (#292)', () => {
  const PERIMETER_ID = 'perimeter-day152-model-abc';

  it('downloads the regenerated perimeter GeoJSON for a perimeter-day result', async () => {
    const geojson = JSON.stringify({ type: 'FeatureCollection', features: [] });
    getPerimeterGeoJSON.mockResolvedValue(geojson);

    const res = await request(buildApp()).get(`/api/v1/results/${PERIMETER_ID}/download`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('geo+json');
    expect(res.text).toBe(geojson);
    expect(getPerimeterGeoJSON).toHaveBeenCalledWith(PERIMETER_ID);
  });
});

describe('/results/:id/download — synthetic arrival-time raster (#292)', () => {
  const ARRIVAL_ID = 'arrival-time-model-abc';

  it('downloads the arrival-time GeoTIFF for an arrival-time result', async () => {
    getArrivalRasterPath.mockResolvedValue('/sims/model-abc/arrival_day172.tif');

    const res = await request(buildApp()).get(`/api/v1/results/${ARRIVAL_ID}/download`);

    // Today this is 404 ("Result not found: arrival-time-model-abc") — the bug.
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('tiff');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(getArrivalRasterPath).toHaveBeenCalledWith(ARRIVAL_ID);
  });
});

describe('/results/:id/download — genuinely missing result', () => {
  it('still returns 404 for a non-synthetic, missing result', async () => {
    const res = await request(buildApp()).get('/api/v1/results/res-missing/download');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});
