/**
 * Characterization tests for the /jobs routes' engine wiring.
 *
 * Phase-2 behaviour-preserving refactor: jobs.ts:144 obtains the engine via the
 * concrete `getFireSTARREngine()` factory and calls its `getWorkingDirectory`.
 * A later step redirects this to a `getEngine(EngineType.FireSTARR)` resolver
 * returning the same singleton. These tests PIN the observable HTTP behaviour
 * BEFORE that swap.
 *
 * They assert OBSERVABLE behaviour only (HTTP status / body), not which factory
 * is called, so they survive the resolver swap. The faked engine exposes
 * `getWorkingDirectory` so the leak-site code path (jobs.ts:145) is exercised.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { getFireSTARREngine, getJobQueue, getJob, getWorkingDirectory } = vi.hoisted(() => {
  const getJob = vi.fn();
  const getWorkingDirectory = vi.fn(() => null);
  const engine = { getWorkingDirectory };
  return {
    getFireSTARREngine: vi.fn(() => engine),
    getJobQueue: vi.fn(() => ({ getJob })),
    getJob,
    getWorkingDirectory,
  };
});

vi.mock('../../../../infrastructure/firestarr/index.js', () => ({
  getFireSTARREngine,
}));

vi.mock('../../../../infrastructure/services/index.js', () => ({
  getJobQueue,
}));

import jobsRouter from '../jobs.js';
import { errorHandler } from '../../../middleware/errorHandler.js';

function buildApp() {
  const app = express();
  app.use('/api/v1', jobsRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  getWorkingDirectory.mockReturnValue(null);
});

describe('/jobs/:id/log-stream engine wiring — characterization', () => {
  it('returns an error status when the job does not exist (engine never reached)', async () => {
    getJob.mockResolvedValue({ success: false, error: Object.assign(new Error('Job not found'), { name: 'NotFoundError' }) });
    const res = await request(buildApp()).get('/api/v1/jobs/job-missing/log-stream');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(getWorkingDirectory).not.toHaveBeenCalled();
  });

  it('acquires the engine and 404s when no working directory exists for the job model', async () => {
    getJob.mockResolvedValue({ success: true, value: { modelId: 'model-x' } });
    const res = await request(buildApp()).get('/api/v1/jobs/job-1/log-stream');
    expect(res.status).toBe(404);
    expect(getFireSTARREngine).toHaveBeenCalled();
    expect(getWorkingDirectory).toHaveBeenCalledWith('model-x');
    expect(res.body.error).toBeDefined();
  });
});
