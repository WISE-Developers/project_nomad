/**
 * DELETE /jobs/:id stops the run (finding F1 of verification/job-lifecycle).
 *
 * The routes, JobQueue, and the Knex repositories are all real, on an in-memory SQLite
 * database built by the real migrations. Only the engine is a fake, because it stands for
 * a FireSTARR container: `execute` runs until the container exits, and `cancel` is the
 * kill. The background run is the real floating IIFE in models.ts.
 *
 * What the operator must be able to rely on:
 *   - a 200 means the engine was stopped and both the job and the model say cancelled;
 *   - a kill that cannot be confirmed answers 500 and marks nothing cancelled;
 *   - nothing the stopped run does afterwards changes that.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Knex } from 'knex';

const h = vi.hoisted(() => {
  const state = {
    db: null as unknown,
    killFails: false,
    holdInit: null as Promise<void> | null,
    containerRunning: false,
    finishContainer: null as null | ((outcome: 'completed' | 'failed') => void),
    outcome: 'completed' as 'completed' | 'failed',
  };
  return { state };
});

vi.mock('../../../../infrastructure/usage/index.js', () => ({
  getUsageLogger: () => ({ record: async () => {} }),
}));

vi.mock('../../../../infrastructure/database/index.js', async () => {
  const { KnexModelRepository } = await import('../../../../infrastructure/database/knex/KnexModelRepository.js');
  const { KnexJobRepository } = await import('../../../../infrastructure/database/knex/KnexJobRepository.js');
  return {
    getModelRepository: () => new KnexModelRepository(h.state.db as Knex),
    getJobRepository: () => new KnexJobRepository(h.state.db as Knex),
    getResultRepository: () => ({
      save: async () => undefined,
      findByModelId: async () => [],
      deleteByModelId: async () => 0,
    }),
  };
});

const engine = vi.hoisted(() => ({
  initialize: vi.fn(async () => {
    if (h.state.holdInit) await h.state.holdInit;
  }),
  execute: vi.fn(async (_id: string, opts?: { signal?: AbortSignal }) => {
    if (opts?.signal?.aborted) throw new Error('Run was cancelled before the engine started');
    h.state.containerRunning = true;
    await new Promise<void>((resolve) => {
      h.state.finishContainer = (outcome) => {
        h.state.outcome = outcome;
        h.state.containerRunning = false;
        resolve();
      };
    });
  }),
  getStatus: vi.fn(async () =>
    h.state.outcome === 'completed' ? { state: 'completed' } : { state: 'failed', error: 'exit 137' },
  ),
  getResults: vi.fn(async () => []),
  cancel: vi.fn(async () => {
    if (h.state.killFails) throw new Error('docker daemon unreachable');
    if (h.state.containerRunning) h.state.finishContainer!('failed');
  }),
  cleanup: vi.fn(async () => undefined),
  getWorkingDirectory: vi.fn(() => null),
}));

vi.mock('../../../../infrastructure/engines/index.js', () => ({
  getEngine: vi.fn(() => engine),
  getWorkspaceAwareEngine: vi.fn(() => engine),
}));

import modelsRouter from '../models.js';
import jobsRouter from '../jobs.js';
import { errorHandler } from '../../../middleware/errorHandler.js';
import { resetJobQueue } from '../../../../infrastructure/services/JobQueue.js';
import { KnexModelRepository } from '../../../../infrastructure/database/knex/KnexModelRepository.js';
import { KnexJobRepository } from '../../../../infrastructure/database/knex/KnexJobRepository.js';
import {
  EngineType,
  FireModel,
  JobStatus,
  ModelStatus,
  createFireModelId,
  createJobId,
} from '../../../../domain/entities/index.js';
import { migratedTestDb } from '../../../../test/migratedTestDb.js';
import { serveOnce } from '../../../../test/sharedServer.js';

const MODEL_ID = 'model-cancel';

function buildApp() {
  const a = express();
  a.use(express.json());
  a.use('/api/v1', modelsRouter);
  a.use('/api/v1', jobsRouter);
  a.use(errorHandler);
  return a;
}

const api = serveOnce(buildApp);

function body() {
  return {
    ignition: { type: 'point', coordinates: [-114.3, 62.5] },
    timeRange: { start: '2026-06-15T14:00:00Z', end: '2026-06-15T20:00:00Z' },
    weather: { source: 'firestarr_csv' },
    timezone: 'America/Edmonton',
  };
}

const jobStatus = async (id: string) =>
  (await new KnexJobRepository(h.state.db as Knex).findById(createJobId(id)))!.status;
const modelStatus = async () =>
  (await new KnexModelRepository(h.state.db as Knex).findById(createFireModelId(MODEL_ID)))!.status;

/** Lets the floating background run take every step it can. */
const settle = () => new Promise((r) => setTimeout(r, 100));

async function startRun(): Promise<string> {
  const res = await request(api()).post(`/api/v1/models/${MODEL_ID}/execute`).send(body());
  expect(res.status).toBe(202);
  return res.body.jobId as string;
}

beforeEach(async () => {
  h.state.db = await migratedTestDb();
  h.state.killFails = false;
  h.state.holdInit = null;
  h.state.containerRunning = false;
  h.state.finishContainer = null;
  h.state.outcome = 'completed';
  vi.clearAllMocks();
  resetJobQueue();
  await new KnexModelRepository(h.state.db as Knex).save(
    new FireModel({
      id: createFireModelId(MODEL_ID),
      name: 'Cancel test',
      engineType: EngineType.FireSTARR,
      status: ModelStatus.Draft,
      userId: 'test-user',
    }),
  );
});

afterEach(async () => {
  h.state.finishContainer?.('completed');
  await settle();
  await (h.state.db as Knex).destroy();
});

describe('DELETE /jobs/:id on a running model', () => {
  it('kills the engine and leaves the job and the model cancelled', async () => {
    const jobId = await startRun();
    await vi.waitFor(() => expect(h.state.containerRunning).toBe(true));

    const res = await request(api()).delete(`/api/v1/jobs/${jobId}`);

    expect(res.status).toBe(200);
    expect(engine.cancel).toHaveBeenCalledWith(MODEL_ID);
    expect(h.state.containerRunning).toBe(false);
    await settle();
    expect(await jobStatus(jobId)).toBe(JobStatus.Cancelled);
    expect(await modelStatus()).toBe(ModelStatus.Cancelled);
  });

  it('answers 500 and marks nothing cancelled when the kill fails', async () => {
    const jobId = await startRun();
    await vi.waitFor(() => expect(h.state.containerRunning).toBe(true));
    h.state.killFails = true;

    const res = await request(api()).delete(`/api/v1/jobs/${jobId}`);

    expect(res.status).toBe(500);
    expect(res.body.error?.message ?? JSON.stringify(res.body)).toMatch(/could not stop|docker daemon unreachable/i);
    expect(await jobStatus(jobId)).toBe(JobStatus.Running);
    expect(await modelStatus()).toBe(ModelStatus.Running);

    // The run was never stopped, so it is still the run's to finish.
    h.state.finishContainer!('completed');
    await settle();
    expect(await jobStatus(jobId)).toBe(JobStatus.Completed);
    expect(await modelStatus()).toBe(ModelStatus.Completed);
  });
});

describe('DELETE /jobs/:id while the engine is still starting up', () => {
  it('stops the run before the engine starts, and both end cancelled', async () => {
    let releaseInit!: () => void;
    h.state.holdInit = new Promise<void>((r) => (releaseInit = r));
    const jobId = await startRun();
    await vi.waitFor(() => expect(engine.initialize).toHaveBeenCalled());

    const res = await request(api()).delete(`/api/v1/jobs/${jobId}`);
    expect(res.status).toBe(200);

    releaseInit();
    await settle();
    expect(h.state.containerRunning).toBe(false);
    expect(await jobStatus(jobId)).toBe(JobStatus.Cancelled);
    expect(await modelStatus()).toBe(ModelStatus.Cancelled);
  });
});

describe('DELETE /jobs/:id on a finished run', () => {
  it('is refused and changes nothing', async () => {
    const jobId = await startRun();
    await vi.waitFor(() => expect(h.state.containerRunning).toBe(true));
    h.state.finishContainer!('completed');
    await settle();

    const res = await request(api()).delete(`/api/v1/jobs/${jobId}`);

    expect(res.status).toBe(400);
    expect(await jobStatus(jobId)).toBe(JobStatus.Completed);
    expect(await modelStatus()).toBe(ModelStatus.Completed);
  });
});
