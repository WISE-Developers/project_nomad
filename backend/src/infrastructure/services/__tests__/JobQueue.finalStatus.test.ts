/**
 * A final job status is final (finding F1 of verification/job-lifecycle).
 *
 * Runs the real JobQueue on the real KnexJobRepository, because the guarantee lives in
 * the SQL: every write is `UPDATE ... WHERE status IN ('pending','running')`. A fake
 * repository would test a copy of that condition, not the condition.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Knex } from 'knex';
import { JobQueue } from '../JobQueue.js';
import { KnexJobRepository } from '../../database/knex/KnexJobRepository.js';
import { KnexModelRepository } from '../../database/knex/KnexModelRepository.js';
import { EngineType, FireModel, JobStatus, createFireModelId } from '../../../domain/entities/index.js';
import type { FireModelId, Job, JobId } from '../../../domain/entities/index.js';
import { migratedTestDb } from '../../../test/migratedTestDb.js';

const MODEL_ID = 'model-f1' as FireModelId;

let db: Knex;
let repo: KnexJobRepository;
let queue: JobQueue;

function makeQueue(jobRepository: KnexJobRepository) {
  return new JobQueue({
    jobRepository,
    modelRepository: { findById: async () => null } as never,
    usageLogger: { record: async () => {} },
    homeTimezone: 'UTC',
    authMode: 'none',
  });
}

async function statusOf(id: JobId): Promise<JobStatus> {
  return (await repo.findById(id))!.status;
}

beforeEach(async () => {
  db = await migratedTestDb();
  repo = new KnexJobRepository(db);
  queue = makeQueue(repo);
  // jobs.model_id is a foreign key, so the model row comes first.
  await new KnexModelRepository(db).save(
    new FireModel({ id: createFireModelId(MODEL_ID), name: 'F1', engineType: EngineType.FireSTARR }),
  );
});

afterEach(async () => {
  await db.destroy();
});

async function newJob(): Promise<Job> {
  const r = await queue.enqueue(MODEL_ID);
  if (!r.success) throw r.error;
  return r.value;
}

describe('a cancelled job stays cancelled', () => {
  it('is not turned back to running', async () => {
    const job = await newJob();
    expect((await queue.cancel(job.id)).success).toBe(true);

    const r = await queue.updateStatus(job.id, JobStatus.Running);

    expect(r.success).toBe(false);
    expect(await statusOf(job.id)).toBe(JobStatus.Cancelled);
  });

  it('is not completed by the run that was not stopped', async () => {
    const job = await newJob();
    await queue.updateStatus(job.id, JobStatus.Running);
    await queue.cancel(job.id);

    const r = await queue.complete(job.id);

    expect(r.success).toBe(false);
    expect(await statusOf(job.id)).toBe(JobStatus.Cancelled);
  });

  it('is not failed by the run that was not stopped', async () => {
    const job = await newJob();
    await queue.updateStatus(job.id, JobStatus.Running);
    await queue.cancel(job.id);

    const r = await queue.fail(job.id, 'engine exited 137');

    expect(r.success).toBe(false);
    expect(await statusOf(job.id)).toBe(JobStatus.Cancelled);
  });

  it('is not reverted by a progress write', async () => {
    const job = await newJob();
    await queue.updateStatus(job.id, JobStatus.Running);
    await queue.cancel(job.id);

    await queue.updateProgress(job.id, 50);

    expect(await statusOf(job.id)).toBe(JobStatus.Cancelled);
  });
});

describe('a completed job stays completed', () => {
  it('is not overwritten by a cancel that read it while it was still running', async () => {
    const job = await newJob();
    await queue.updateStatus(job.id, JobStatus.Running);

    // Hold the cancel between its read and its write, and let the run finish there.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const slowRepo = Object.create(repo) as KnexJobRepository;
    slowRepo.findById = async (id: JobId) => {
      const found = await repo.findById(id);
      await held;
      return found;
    };
    const cancelling = makeQueue(slowRepo).cancel(job.id);
    await new Promise((r) => setTimeout(r, 10));

    await queue.complete(job.id);
    release();
    const r = await cancelling;

    expect(r.success).toBe(false);
    expect(await statusOf(job.id)).toBe(JobStatus.Completed);
  });
});
