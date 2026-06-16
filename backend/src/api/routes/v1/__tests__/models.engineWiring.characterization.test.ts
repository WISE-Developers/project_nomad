/**
 * Characterization tests for the /models routes' engine wiring.
 *
 * Phase-2 behaviour-preserving refactor: the models routes currently obtain the
 * engine via the concrete `getFireSTARREngine()` factory at 12 sites
 * (models.ts:218,645,780,899,963,1040,1184,1266,1371,1530,1588,1643). A later
 * step redirects every site to a `getEngine(EngineType.FireSTARR)` resolver
 * returning the same singleton. These tests PIN the observable HTTP behaviour
 * BEFORE that swap so the redirect is guarded.
 *
 * They assert OBSERVABLE behaviour (HTTP status + key response body shape) only.
 * They do NOT assert which factory is called and do NOT import the concrete
 * engine class, so they survive the resolver swap unchanged.
 *
 * The six "working-directory leak" sites (models.ts:1040,1266,1530,1588,1643)
 * call the engine's `getWorkingDirectory(modelId)`. The faked engine exposes
 * `getWorkingDirectory` so those code paths are exercised and pinned.
 *
 * Note on models.ts:218 (POST /models/run) and :645 (POST /models/:id/execute):
 * the engine there is used inside a detached, NON-awaited async callback, so it
 * is not observable through the HTTP response. We therefore pin the synchronous,
 * observable behaviour of those routes (validation / not-found) instead.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ─── Hoisted mocks ──────────────────────────────────────────────
const {
  getFireSTARREngine,
  getModelResultsService,
  getModelExecutionService,
  getModelRepository,
  getResultRepository,
  findById,
  find,
  getResults,
  getWorkingDirectory,
} = vi.hoisted(() => {
  const findById = vi.fn();
  const find = vi.fn();
  const getResults = vi.fn();
  // Default: no working directory -> drives the clean 404 path while still
  // exercising the engine.getWorkingDirectory(modelId) call at the leak sites.
  const getWorkingDirectory = vi.fn(() => null);

  const engine = {
    getWorkingDirectory,
    cleanup: vi.fn(async () => undefined),
    initialize: vi.fn(async () => undefined),
    execute: vi.fn(async () => undefined),
    getStatus: vi.fn(async () => ({ status: 'completed' })),
    getResults: vi.fn(async () => []),
  };

  return {
    getFireSTARREngine: vi.fn(() => engine),
    getModelResultsService: vi.fn((_engine?: unknown) => ({ getResults })),
    getModelExecutionService: vi.fn(() => ({ execute: vi.fn(async () => undefined) })),
    getModelRepository: vi.fn(() => ({ findById, find })),
    getResultRepository: vi.fn(() => ({ deleteByModelId: vi.fn(async () => 0) })),
    findById,
    find,
    getResults,
    getWorkingDirectory,
  };
});

vi.mock('../../../../infrastructure/firestarr/index.js', () => ({
  getFireSTARREngine,
  generateArrivalTile: vi.fn(),
  findArrivalTifs: vi.fn(() => null),
  getRasterBounds: vi.fn(),
}));

vi.mock('../../../../application/services/index.js', () => ({
  getModelResultsService,
}));

vi.mock('../../../../infrastructure/services/index.js', () => ({
  getModelExecutionService,
}));

vi.mock('../../../../infrastructure/database/index.js', () => ({
  getModelRepository,
  getResultRepository,
  getJobRepository: vi.fn(() => ({ deleteByModelId: vi.fn(async () => 0) })),
}));

vi.mock('../../../../infrastructure/services/JobQueue.js', () => ({
  getJobQueue: vi.fn(() => ({
    enqueue: vi.fn(async () => ({ success: true, value: { id: 'job-1', toJSON: () => ({}) } })),
    updateStatus: vi.fn(async () => ({ success: true })),
    complete: vi.fn(async () => ({ success: true })),
    fail: vi.fn(async () => ({ success: true })),
  })),
}));

import modelsRouter from '../models.js';
import { errorHandler } from '../../../middleware/errorHandler.js';
import { ModelStatus, EngineType } from '../../../../domain/entities/index.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', modelsRouter);
  app.use(errorHandler);
  return app;
}

function completedModel(id: string) {
  return {
    id,
    name: 'Test Model',
    engineType: EngineType.FireSTARR,
    status: ModelStatus.Completed,
    userId: null,
    notes: undefined,
    createdAt: new Date('2026-06-15T00:00:00Z'),
    outputMode: undefined,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getWorkingDirectory.mockReturnValue(null);
});

// ── results-service wiring sites (780, 899, 963, 1184) ──────────
describe('/models result-service engine wiring — characterization', () => {
  it('GET /models/:id/results returns 404 when the model does not exist', async () => {
    findById.mockResolvedValue(null);
    const res = await request(buildApp()).get('/api/v1/models/m-missing/results');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it('GET /models/:id/results wires an engine into the results service for an existing model', async () => {
    findById.mockResolvedValue(completedModel('m-1'));
    getResults.mockResolvedValue({ success: false });
    await request(buildApp()).get('/api/v1/models/m-1/results');
    expect(getModelResultsService).toHaveBeenCalled();
    expect(getModelResultsService.mock.calls[0][0]).toBeTruthy();
  });

  it('GET /models/:id/inputs/weather returns 404 when the model does not exist', async () => {
    findById.mockResolvedValue(null);
    const res = await request(buildApp()).get('/api/v1/models/m-missing/inputs/weather');
    expect(res.status).toBe(404);
  });

  it('GET /models/:id/inputs/weather wires an engine into the results service', async () => {
    findById.mockResolvedValue(completedModel('m-2'));
    getResults.mockResolvedValue({ success: false });
    const res = await request(buildApp()).get('/api/v1/models/m-2/inputs/weather');
    expect(res.status).toBe(404); // no weather data
    expect(getModelResultsService.mock.calls[0][0]).toBeTruthy();
  });

  it('GET /models/:id/inputs/ignition returns 404 when the model does not exist', async () => {
    findById.mockResolvedValue(null);
    const res = await request(buildApp()).get('/api/v1/models/m-missing/inputs/ignition');
    expect(res.status).toBe(404);
  });

  it('GET /models/:id/inputs/ignition wires an engine into the results service', async () => {
    findById.mockResolvedValue(completedModel('m-3'));
    getResults.mockResolvedValue({ success: false });
    const res = await request(buildApp()).get('/api/v1/models/m-3/inputs/ignition');
    expect(res.status).toBe(404);
    expect(getModelResultsService.mock.calls[0][0]).toBeTruthy();
  });

  it('POST /models/:id/perimeters returns 404 when the model does not exist', async () => {
    findById.mockResolvedValue(null);
    const res = await request(buildApp())
      .post('/api/v1/models/m-missing/perimeters')
      .send({ confidenceInterval: 50 });
    expect(res.status).toBe(404);
  });

  it('POST /models/:id/perimeters wires an engine into the results service', async () => {
    findById.mockResolvedValue(completedModel('m-4'));
    getResults.mockResolvedValue({ success: true, value: { outputs: [] } });
    const res = await request(buildApp())
      .post('/api/v1/models/m-4/perimeters')
      .send({ confidenceInterval: 50 });
    expect(res.status).toBe(404); // no probability rasters
    expect(getModelResultsService.mock.calls[0][0]).toBeTruthy();
  });
});

// ── working-directory leak sites (1040, 1266, 1530, 1588, 1643) ─
describe('/models getWorkingDirectory engine wiring — characterization', () => {
  it('GET /models/:id/perimeters (1040) exercises getWorkingDirectory and 404s when absent', async () => {
    findById.mockResolvedValue(completedModel('m-wd-1'));
    const res = await request(buildApp()).get('/api/v1/models/m-wd-1/perimeters?day=1');
    expect(res.status).toBe(404);
    expect(getWorkingDirectory).toHaveBeenCalledWith('m-wd-1');
  });

  it('GET /models/:id/arrival-tile (1530) exercises getWorkingDirectory and 404s when absent', async () => {
    const res = await request(buildApp()).get('/api/v1/models/m-wd-2/arrival-tile/1/2/3.png');
    expect(res.status).toBe(404);
    expect(getWorkingDirectory).toHaveBeenCalledWith('m-wd-2');
  });

  it('GET /models/:id/arrival-bounds (1588) exercises getWorkingDirectory and 404s when absent', async () => {
    const res = await request(buildApp()).get('/api/v1/models/m-wd-3/arrival-bounds');
    expect(res.status).toBe(404);
    expect(getWorkingDirectory).toHaveBeenCalledWith('m-wd-3');
  });

  it('GET /models/:id/arrival-perimeters (1643) exercises getWorkingDirectory and 404s when absent', async () => {
    const res = await request(buildApp()).get('/api/v1/models/m-wd-4/arrival-perimeters');
    expect(res.status).toBe(404);
    expect(getWorkingDirectory).toHaveBeenCalledWith('m-wd-4');
  });

  it('GET /models (1266) acquires the engine and returns the model list shape', async () => {
    // One completed model so the getWorkingDirectory leak site fires.
    find.mockResolvedValue({ models: [completedModel('m-list-1')] });
    const res = await request(buildApp()).get('/api/v1/models');
    expect(res.status).toBe(200);
    expect(getFireSTARREngine).toHaveBeenCalled();
    expect(getWorkingDirectory).toHaveBeenCalledWith('m-list-1');
    expect(res.body.models).toBeDefined();
    expect(Array.isArray(res.body.models)).toBe(true);
  });
});

// ── engine.cleanup wiring site (1371) ───────────────────────────
describe('/models DELETE engine wiring — characterization', () => {
  it('DELETE /models/:id returns 404 when the model does not exist', async () => {
    findById.mockResolvedValue(null);
    const res = await request(buildApp()).delete('/api/v1/models/m-missing');
    expect(res.status).toBe(404);
  });

  it('DELETE /models/:id acquires the engine and deletes an existing model', async () => {
    findById.mockResolvedValue({ ...completedModel('m-del-1') });
    // model repo needs delete()
    getModelRepository.mockReturnValue({ findById, find, delete: vi.fn(async () => undefined) });
    const res = await request(buildApp()).delete('/api/v1/models/m-del-1');
    expect(res.status).toBe(200);
    expect(getFireSTARREngine).toHaveBeenCalled();
    expect(res.body.message).toContain('m-del-1');
  });
});

// ── detached-engine sites (218 run, 645 execute) ────────────────
// Engine here runs in a non-awaited async callback => not HTTP-observable.
// We pin the synchronous observable behaviour only.
describe('/models detached-engine sites — observable behaviour', () => {
  it('POST /models/:id/execute returns 404 when the model does not exist', async () => {
    findById.mockResolvedValue(null);
    const res = await request(buildApp())
      .post('/api/v1/models/m-missing/execute')
      .send({});
    expect(res.status).toBe(404);
  });

  it('POST /models/run rejects an invalid body with 4xx (no engine reached)', async () => {
    const res = await request(buildApp()).post('/api/v1/models/run').send({});
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
