/**
 * Regression test for bug #292 — "Can't download fire perimeters".
 *
 * Deterministic fire-growth perimeters are SYNTHETIC outputs: they are built
 * in-memory by ModelResultsService.getResults() with id
 * `perimeter-day{julianDay}-{modelId}` and advertised in the results list, but
 * they are NEVER persisted to the result repository. The display path works
 * because it regenerates the perimeter on demand from the probability raster.
 *
 * The download path (GET /results/:resultId/download), however, resolves via
 * getResultById() -> repo.findById(), which has no such row, so it throws
 * NotFoundError('Result', id) -> "Result not found: perimeter-day152-..." (404).
 * That is the user-reported failure.
 *
 * Fix (Option 1): when the repo has no row for a synthetic `perimeter-day...`
 * id, the route regenerates the perimeter GeoJSON on demand (the same way the
 * display path does) and streams it as a download.
 *
 * These tests assert OBSERVABLE HTTP behavior so they remain valid across the
 * implementation. The first test is RED until the fix lands.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Hoisted mocks (vi.mock factories are hoisted above top-level consts).
const { getResultById, getPerimeterGeoJSON, getModelResultsService } = vi.hoisted(() => {
  const getResultById = vi.fn();
  const getPerimeterGeoJSON = vi.fn();
  const getModelResultsService = vi.fn((_engine?: unknown) => ({
    getResultById,
    getPerimeterGeoJSON,
  }));
  return { getResultById, getPerimeterGeoJSON, getModelResultsService };
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

import resultsRouter from '../results.js';
import { errorHandler } from '../../../middleware/errorHandler.js';

function buildApp() {
  const app = express();
  app.use('/api/v1', resultsRouter);
  app.use(errorHandler);
  return app;
}

const PERIMETER_ID = 'perimeter-day152-model-abc';

describe('/results/:id/download — synthetic perimeter download (#292)', () => {
  beforeEach(() => {
    getResultById.mockReset();
    getPerimeterGeoJSON.mockReset();
    getModelResultsService.mockClear();
    // Synthetic perimeters are never persisted -> the repo lookup is always null.
    getResultById.mockResolvedValue(null);
  });

  it('downloads the regenerated perimeter GeoJSON for a perimeter-day result', async () => {
    const geojson = JSON.stringify({ type: 'FeatureCollection', features: [] });
    getPerimeterGeoJSON.mockResolvedValue(geojson);

    const res = await request(buildApp()).get(`/api/v1/results/${PERIMETER_ID}/download`);

    // Today this is 404 ("Result not found: perimeter-day152-...") — the bug.
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('geo+json');
    expect(res.text).toBe(geojson);
    expect(getPerimeterGeoJSON).toHaveBeenCalledWith(PERIMETER_ID);
  });

  it('still returns 404 for a genuinely missing, non-perimeter result', async () => {
    // Not a perimeter id and no stored row -> nothing to regenerate.
    getPerimeterGeoJSON.mockResolvedValue(undefined);

    const res = await request(buildApp()).get('/api/v1/results/res-missing/download');

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});
