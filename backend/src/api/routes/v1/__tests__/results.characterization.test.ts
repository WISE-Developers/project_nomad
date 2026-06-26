/**
 * Characterization tests for the /results routes' engine wiring.
 *
 * Phase-2 remediation Item 1 (inventory #2): the four result routes currently
 * obtain the engine via the concrete `getFireSTARREngine()` factory and pass it
 * to `getModelResultsService(engine)` (results.ts:59,171,261,301). These tests
 * PIN the observable HTTP behavior + the fact that an engine is wired into the
 * results service, BEFORE the route is redirected to a `getEngine()` resolver.
 *
 * They assert OBSERVABLE behavior (HTTP status, and that an engine object is
 * passed to the service) — NOT which concrete factory is called — so they stay
 * green across the resolver refactor. Any change in HTTP behavior is a behavior
 * change, which is forbidden.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Hoisted mocks (vi.mock factories are hoisted above top-level consts, so the
// mock fns must be created via vi.hoisted to be referenceable inside them).
const { getResultById, getPerimeterGeoJSON, getArrivalRasterPath, getModelResultsService } = vi.hoisted(() => {
  const getResultById = vi.fn();
  // Synthetic-output regeneration seams (#292); return undefined for these
  // non-synthetic ids so the download route falls through to NotFoundError -> 404.
  const getPerimeterGeoJSON = vi.fn();
  const getArrivalRasterPath = vi.fn();
  const getModelResultsService = vi.fn((_engine?: unknown) => ({
    getResultById,
    getPerimeterGeoJSON,
    getArrivalRasterPath,
  }));
  return { getResultById, getPerimeterGeoJSON, getArrivalRasterPath, getModelResultsService };
});

// Fake results service: no stored result -> route throws NotFoundError -> 404.
vi.mock('../../../../application/services/index.js', () => ({
  getModelResultsService,
}));

// Stub the firestarr infra module so importing the route is inert (no GDAL/native).
// None of these are reached on the not-found path, but the import must resolve.
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

const ROUTES = [
  { name: 'preview', path: '/api/v1/results/res-missing/preview' },
  { name: 'tile', path: '/api/v1/results/res-missing/tile/1/2/3.png' },
  { name: 'bounds', path: '/api/v1/results/res-missing/bounds' },
  { name: 'download', path: '/api/v1/results/res-missing/download' },
];

describe('/results routes — engine-wiring characterization', () => {
  beforeEach(() => {
    getResultById.mockClear();
    getPerimeterGeoJSON.mockClear();
    getArrivalRasterPath.mockClear();
    getModelResultsService.mockClear();
    getResultById.mockResolvedValue(null);
    getPerimeterGeoJSON.mockResolvedValue(undefined);
    getArrivalRasterPath.mockResolvedValue(undefined);
  });

  for (const route of ROUTES) {
    it(`GET ${route.name}: returns 404 when the result does not exist`, async () => {
      const res = await request(buildApp()).get(route.path);
      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
    });

    it(`GET ${route.name}: wires an engine into the results service`, async () => {
      await request(buildApp()).get(route.path);
      // Route obtained an engine and passed it to getModelResultsService.
      // Refactor-robust: asserts an engine is supplied, not which factory.
      expect(getModelResultsService).toHaveBeenCalledTimes(1);
      const engineArg = getModelResultsService.mock.calls[0][0];
      expect(engineArg).toBeTruthy();
      // And the route reached the service with the requested result id.
      expect(getResultById).toHaveBeenCalledWith('res-missing');
    });
  }
});
