/**
 * Startup recovery leaves nothing waiting forever (findings F2 and F3 of
 * verification/job-lifecycle).
 *
 * The process that drove a run is gone after a restart, and nothing resumes runs. So
 * every job still pending or running is failed, and every model still queued or running,
 * or still draft but with a job, takes the outcome of its latest job. Real
 * KnexJobRepository and KnexModelRepository on the real migrations.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Knex } from 'knex';
import { JobQueue } from '../JobQueue.js';
import { KnexJobRepository } from '../../database/knex/KnexJobRepository.js';
import { KnexModelRepository } from '../../database/knex/KnexModelRepository.js';
import {
  EngineType,
  FireModel,
  Job,
  JobStatus,
  ModelStatus,
  createFireModelId,
  createJobId,
} from '../../../domain/entities/index.js';
import type { UsageEvent } from '../../../domain/value-objects/UsageEvent.js';
import { migratedTestDb } from '../../../test/migratedTestDb.js';

let db: Knex;
let jobs: KnexJobRepository;
let models: KnexModelRepository;
let events: UsageEvent[];

beforeEach(async () => {
  db = await migratedTestDb();
  jobs = new KnexJobRepository(db);
  models = new KnexModelRepository(db);
  events = [];
});

afterEach(async () => {
  await db.destroy();
});

function boot() {
  return new JobQueue({
    jobRepository: jobs,
    modelRepository: models,
    usageLogger: { record: async (e) => { events.push(e); } },
    homeTimezone: 'UTC',
    authMode: 'none',
  }).initialize();
}

async function model(id: string, status: ModelStatus) {
  await models.save(
    new FireModel({ id: createFireModelId(id), name: id, engineType: EngineType.FireSTARR, status }),
  );
}

let seq = 0;
async function job(modelId: string, status: JobStatus) {
  seq += 1;
  await jobs.save(
    new Job({
      id: createJobId(`job-${seq}`),
      modelId: createFireModelId(modelId),
      status,
      // Later jobs are newer, so "latest job" is well defined.
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, seq)),
    }),
  );
  return createJobId(`job-${seq}`);
}

const modelStatus = async (id: string) => (await models.findById(createFireModelId(id)))!.status;
const jobStatus = async (id: ReturnType<typeof createJobId>) => (await jobs.findById(id))!.status;

describe('jobs after a restart', () => {
  it('fails a job that was running', async () => {
    await model('m', ModelStatus.Running);
    const j = await job('m', JobStatus.Running);
    await boot();
    expect(await jobStatus(j)).toBe(JobStatus.Failed);
  });

  it('fails a job that was still pending (F2)', async () => {
    await model('m', ModelStatus.Queued);
    const j = await job('m', JobStatus.Pending);
    await boot();
    expect(await jobStatus(j)).toBe(JobStatus.Failed);
  });

  it('leaves final jobs alone', async () => {
    await model('m', ModelStatus.Completed);
    const done = await job('m', JobStatus.Completed);
    const cancelled = await job('m', JobStatus.Cancelled);
    await boot();
    expect(await jobStatus(done)).toBe(JobStatus.Completed);
    expect(await jobStatus(cancelled)).toBe(JobStatus.Cancelled);
  });

  it('records one model.run.failed per interrupted job, pending or running', async () => {
    await model('a', ModelStatus.Running);
    await model('b', ModelStatus.Queued);
    await job('a', JobStatus.Running);
    await job('b', JobStatus.Pending);
    await boot();
    expect(events.filter((e) => e.type === 'model.run.failed')).toHaveLength(2);
  });
});

describe('models after a restart (F3)', () => {
  it('fails a running model whose job was interrupted', async () => {
    await model('m', ModelStatus.Running);
    await job('m', JobStatus.Running);
    await boot();
    expect(await modelStatus('m')).toBe(ModelStatus.Failed);
  });

  it('fails a queued model that never got a job', async () => {
    await model('m', ModelStatus.Queued);
    await boot();
    expect(await modelStatus('m')).toBe(ModelStatus.Failed);
  });

  it('completes a running model whose job had completed', async () => {
    await model('m', ModelStatus.Running);
    await job('m', JobStatus.Completed);
    await boot();
    expect(await modelStatus('m')).toBe(ModelStatus.Completed);
  });

  it('cancels a running model whose job had been cancelled', async () => {
    await model('m', ModelStatus.Running);
    await job('m', JobStatus.Cancelled);
    await boot();
    expect(await modelStatus('m')).toBe(ModelStatus.Cancelled);
  });

  it('cancels a draft model whose job had been cancelled (MCP never writes queued)', async () => {
    await model('m', ModelStatus.Draft);
    await job('m', JobStatus.Cancelled);
    await boot();
    expect(await modelStatus('m')).toBe(ModelStatus.Cancelled);
  });

  it('uses the LATEST job, not an older one', async () => {
    await model('m', ModelStatus.Running);
    await job('m', JobStatus.Completed);
    await job('m', JobStatus.Running);
    await boot();
    expect(await modelStatus('m')).toBe(ModelStatus.Failed);
  });

  it('leaves a draft model with no job, and final models, alone', async () => {
    await model('draft', ModelStatus.Draft);
    await model('done', ModelStatus.Completed);
    await job('done', JobStatus.Completed);
    await model('failed', ModelStatus.Failed);
    await boot();
    expect(await modelStatus('draft')).toBe(ModelStatus.Draft);
    expect(await modelStatus('done')).toBe(ModelStatus.Completed);
    expect(await modelStatus('failed')).toBe(ModelStatus.Failed);
  });
});

describe('the server runs this recovery at startup', () => {
  it('through recoverAfterRestart, not a narrower repository sweep', () => {
    const index = readFileSync(join(__dirname, '..', '..', '..', 'index.ts'), 'utf8');
    expect(index).toMatch(/recoverAfterRestart\(\{[^}]*jobQueue: getJobQueue\(\)/s);
    expect(index).not.toMatch(/markRunningAsFailed/);
  });
});
