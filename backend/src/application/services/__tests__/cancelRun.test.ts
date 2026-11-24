/**
 * cancelRun and runRegistry: the ordering that keeps a cancel and the run it stops from
 * contradicting each other (finding F1 of verification/job-lifecycle). Each test pins one
 * step the model checker showed is load-bearing.
 *
 * Real JobQueue and Knex repositories on the real migrations; the engine is a fake whose
 * kill can be held open or made to fail.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Knex } from 'knex';
import { cancelRun } from '../cancelRun.js';
import { RunRegistry } from '../runRegistry.js';
import { JobQueue } from '../../../infrastructure/services/JobQueue.js';
import { KnexJobRepository } from '../../../infrastructure/database/knex/KnexJobRepository.js';
import { KnexModelRepository } from '../../../infrastructure/database/knex/KnexModelRepository.js';
import {
  EngineType,
  FireModel,
  JobStatus,
  ModelStatus,
  createFireModelId,
} from '../../../domain/entities/index.js';
import type { Job } from '../../../domain/entities/index.js';
import type { IFireModelingEngine } from '../../interfaces/IFireModelingEngine.js';
import { EngineError } from '../../../domain/errors/index.js';
import { migratedTestDb } from '../../../test/migratedTestDb.js';

const MODEL_ID = createFireModelId('model-cancel-run');

let db: Knex;
let jobs: KnexJobRepository;
let models: KnexModelRepository;
let queue: JobQueue;
let runs: RunRegistry;

beforeEach(async () => {
  db = await migratedTestDb();
  jobs = new KnexJobRepository(db);
  models = new KnexModelRepository(db);
  queue = new JobQueue({
    jobRepository: jobs,
    modelRepository: models,
    usageLogger: { record: async () => {} },
    homeTimezone: 'UTC',
    authMode: 'none',
  });
  runs = new RunRegistry();
  await models.save(
    new FireModel({ id: MODEL_ID, name: 'cancelRun', engineType: EngineType.FireSTARR, status: ModelStatus.Running }),
  );
});

afterEach(async () => {
  await db.destroy();
});

async function runningJob(): Promise<Job> {
  const r = await queue.enqueue(MODEL_ID);
  if (!r.success) throw r.error;
  await queue.updateStatus(r.value.id, JobStatus.Running);
  return r.value;
}

function engineWith(cancel: IFireModelingEngine['cancel']): IFireModelingEngine {
  return { cancel } as unknown as IFireModelingEngine;
}

const deps = (engine: IFireModelingEngine) => ({
  jobQueue: queue,
  modelRepository: models,
  engineFor: () => engine,
  runs,
});

describe('cancelRun', () => {
  it('fires the run signal BEFORE it asks the engine to stop', async () => {
    const job = await runningJob();
    const handle = runs.register(job.id, MODEL_ID);
    let abortedWhenKillStarted: boolean | undefined;

    await cancelRun(job.id, deps(engineWith(async () => {
      abortedWhenKillStarted = handle.signal.aborted;
    })));

    expect(abortedWhenKillStarted).toBe(true);
  });

  it('makes the run wait while the kill is in flight, then reports it stopped', async () => {
    const job = await runningJob();
    const handle = runs.register(job.id, MODEL_ID);
    let finishKill!: () => void;
    const cancelling = cancelRun(job.id, deps(engineWith(() => new Promise<void>((r) => (finishKill = r)))));
    await vi.waitFor(() => expect(finishKill).toBeTypeOf('function'));

    let answered: boolean | undefined;
    void handle.stoppedByCancel().then((v) => (answered = v));
    await new Promise((r) => setTimeout(r, 20));
    expect(answered, 'the run must not resolve itself while the kill is still in flight').toBeUndefined();

    finishKill();
    await cancelling;
    await vi.waitFor(() => expect(answered).toBe(true));
  });

  it('writes the job AND the model cancelled once the kill is confirmed', async () => {
    const job = await runningJob();
    runs.register(job.id, MODEL_ID);

    await cancelRun(job.id, deps(engineWith(async () => undefined)));

    expect((await jobs.findById(job.id))!.status).toBe(JobStatus.Cancelled);
    expect((await models.findById(MODEL_ID))!.status).toBe(ModelStatus.Cancelled);
  });

  it('fails loudly when the kill fails, and marks nothing cancelled', async () => {
    const job = await runningJob();
    const handle = runs.register(job.id, MODEL_ID);

    const attempt = cancelRun(job.id, deps(engineWith(async () => {
      throw new Error('docker ps failed');
    })));

    await expect(attempt).rejects.toBeInstanceOf(EngineError);
    await expect(attempt).rejects.toThrow(/was not cancelled: docker ps failed/);
    expect((await jobs.findById(job.id))!.status).toBe(JobStatus.Running);
    expect((await models.findById(MODEL_ID))!.status).toBe(ModelStatus.Running);
    expect(await handle.stoppedByCancel(), 'the run is still the run\'s to finish').toBe(false);
  });

  it('still kills and confirms when no run is registered in this process', async () => {
    const job = await runningJob();
    const kill = vi.fn(async () => undefined);

    await cancelRun(job.id, deps(engineWith(kill)));

    expect(kill).toHaveBeenCalledWith(MODEL_ID);
  });
});

describe('KnexModelRepository.updateStatusUnlessCancelled', () => {
  it('does not overwrite a cancelled model', async () => {
    await models.updateStatus(MODEL_ID, ModelStatus.Cancelled);

    const written = await models.updateStatusUnlessCancelled(MODEL_ID, ModelStatus.Running);

    expect(written).toBe(false);
    expect((await models.findById(MODEL_ID))!.status).toBe(ModelStatus.Cancelled);
  });

  it('writes any other model', async () => {
    expect(await models.updateStatusUnlessCancelled(MODEL_ID, ModelStatus.Completed)).toBe(true);
    expect((await models.findById(MODEL_ID))!.status).toBe(ModelStatus.Completed);
  });
});
