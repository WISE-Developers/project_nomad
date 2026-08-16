import { describe, it, expect, beforeEach } from 'vitest';
import { JobQueue } from '../JobQueue.js';
import { Job, JobStatus, createJobId } from '../../../domain/entities/index.js';
import type { JobId, FireModelId } from '../../../domain/entities/index.js';
import type { IUsageLogger } from '../../../application/interfaces/IUsageLogger.js';
import type { UsageEvent } from '../../../domain/value-objects/UsageEvent.js';

const ZONE = 'America/Edmonton';
const MODEL_ID = 'model-1' as FireModelId;

/**
 * Model run events (#332).
 *
 * Emitted from JobQueue rather than FireSTARREngine: the engine's run state is
 * in-memory and dies on restart, while jobs are persisted. Emitting from the
 * engine alone would silently lose every restart-interrupted run — exactly the
 * kind of quiet gap that makes a log lie by omission.
 *
 * The actor comes from fire_models.user_id via the job's model. No column was
 * added to jobs: ownership is already modelled, and two copies of an owner is
 * how they end up disagreeing.
 */

function collectingLogger(): IUsageLogger & { events: UsageEvent[] } {
  const events: UsageEvent[] = [];
  return { events, record: async (e) => { events.push(e); } };
}

class FakeJobRepo {
  jobs = new Map<string, Job>();

  async save(job: Job): Promise<void> {
    this.jobs.set(job.id, job);
  }
  async update(job: Job): Promise<void> {
    this.jobs.set(job.id, job);
  }
  async findById(id: JobId): Promise<Job | null> {
    return this.jobs.get(id) ?? null;
  }
  async findByStatus(status: JobStatus): Promise<Job[]> {
    return [...this.jobs.values()].filter((j) => j.status === status);
  }
  async markRunningAsFailed(): Promise<number> {
    const running = await this.findByStatus(JobStatus.Running);
    for (const j of running) {
      this.jobs.set(j.id, j.withError('Interrupted by restart'));
    }
    return running.length;
  }
}

function fakeModelRepo(userId?: string) {
  return {
    findById: async () => ({ id: MODEL_ID, userId }),
  };
}

function makeQueue(opts: {
  logger: IUsageLogger;
  repo: FakeJobRepo;
  userId?: string;
  authMode?: 'none' | 'simple' | 'oauth' | 'acn';
}) {
  return new JobQueue({
    jobRepository: opts.repo as never,
    modelRepository: fakeModelRepo(opts.userId) as never,
    usageLogger: opts.logger,
    homeTimezone: ZONE,
    authMode: opts.authMode ?? 'simple',
  });
}

describe('JobQueue usage events', () => {
  let repo: FakeJobRepo;
  let log: ReturnType<typeof collectingLogger>;

  beforeEach(() => {
    repo = new FakeJobRepo();
    log = collectingLogger();
  });

  // model.run.started is emitted at ENQUEUE, meaning "a run was requested".
  //
  // It was originally emitted on the Pending -> Running transition, but a run
  // that dies during input generation never reaches Running - so it produced a
  // model.run.failed with no matching started, and failed/started could exceed
  // 100%. Verified in a real deployment: a SpotWX key error emitted failed
  // alone. Pairing every run makes the log safe to aggregate without knowing
  // that caveat.
  it('records model.run.started when a run is requested', async () => {
    const q = makeQueue({ logger: log, repo, userId: 'franco' });
    await q.enqueue(MODEL_ID);

    expect(log.events).toHaveLength(1);
    expect(log.events[0].type).toBe('model.run.started');
    expect(log.events[0].modelId).toBe(MODEL_ID);
  });

  it('does not record a second start when the job begins running', async () => {
    const q = makeQueue({ logger: log, repo, userId: 'franco' });
    const job = (await q.enqueue(MODEL_ID)).value as Job;
    await q.updateStatus(job.id, JobStatus.Running);

    const started = log.events.filter((e) => e.type === 'model.run.started');
    expect(started).toHaveLength(1);
  });

  it('pairs every failure with a start, even when the run never reaches the engine', async () => {
    const q = makeQueue({ logger: log, repo, userId: 'franco' });
    const job = (await q.enqueue(MODEL_ID)).value as Job;
    // Straight to failed, as an input-generation error does - no Running.
    await q.fail(job.id, 'SpotWX API key required');

    const started = log.events.filter((e) => e.type === 'model.run.started');
    const failed = log.events.filter((e) => e.type === 'model.run.failed');
    expect(started).toHaveLength(1);
    expect(failed).toHaveLength(1);
  });

  it('attributes the run to the model owner', async () => {
    const q = makeQueue({ logger: log, repo, userId: 'franco@example.ca' });
    const job = (await q.enqueue(MODEL_ID)).value as Job;
    await q.updateStatus(job.id, JobStatus.Running);

    expect(log.events[0].actor).toBe('franco@example.ca');
  });

  it('uses "User" when the model has no owner in none mode', async () => {
    const q = makeQueue({ logger: log, repo, authMode: 'none' });
    const job = (await q.enqueue(MODEL_ID)).value as Job;
    await q.updateStatus(job.id, JobStatus.Running);

    expect(log.events[0].actor).toBe('User');
  });

  it('uses "Unknown User" when the model has no owner in an identified mode', async () => {
    const q = makeQueue({ logger: log, repo, authMode: 'simple' });
    const job = (await q.enqueue(MODEL_ID)).value as Job;
    await q.updateStatus(job.id, JobStatus.Running);

    expect(log.events[0].actor).toBe('Unknown User');
  });

  it('records model.run.completed with a wall-clock duration', async () => {
    const q = makeQueue({ logger: log, repo, userId: 'franco' });
    const job = (await q.enqueue(MODEL_ID)).value as Job;
    await q.updateStatus(job.id, JobStatus.Running);
    await q.complete(job.id);

    const done = log.events.find((e) => e.type === 'model.run.completed');
    expect(done).toBeDefined();
    expect(typeof done?.detail?.wall_clock_seconds).toBe('number');
  });

  it('records model.run.failed with the reason', async () => {
    const q = makeQueue({ logger: log, repo, userId: 'franco' });
    const job = (await q.enqueue(MODEL_ID)).value as Job;
    await q.updateStatus(job.id, JobStatus.Running);
    await q.fail(job.id, 'Process exited with code 1');

    const failed = log.events.find((e) => e.type === 'model.run.failed');
    expect(failed).toBeDefined();
    expect(failed?.detail?.reason).toBe('Process exited with code 1');
  });

  it('records a failure for each run interrupted by a restart', async () => {
    // The reason JobQueue is the emission point rather than the engine: these
    // failures happen at boot with no request and no in-memory state.
    const seeded = new Job({
      id: createJobId('job-restart'),
      modelId: MODEL_ID,
      status: JobStatus.Running,
    });
    await repo.save(seeded);

    const q = makeQueue({ logger: log, repo, userId: 'franco' });
    await q.initialize();

    const failed = log.events.filter((e) => e.type === 'model.run.failed');
    expect(failed).toHaveLength(1);
    expect(failed[0].detail?.interrupted_by_restart).toBe(true);
    expect(failed[0].actor).toBe('franco');
  });

  it('does not fail the job operation when the usage logger throws', async () => {
    const exploding: IUsageLogger = {
      record: async () => {
        throw new Error('disk full');
      },
    };
    const q = makeQueue({ logger: exploding, repo, userId: 'franco' });
    const job = (await q.enqueue(MODEL_ID)).value as Job;

    const result = await q.updateStatus(job.id, JobStatus.Running);
    expect(result.success).toBe(true);
  });

  it('stamps run events in the configured zone', async () => {
    const q = makeQueue({ logger: log, repo, userId: 'franco' });
    const job = (await q.enqueue(MODEL_ID)).value as Job;
    await q.updateStatus(job.id, JobStatus.Running);

    expect(log.events[0].ts_local).toMatch(/[+-]0[67]:00$/);
    expect(log.events[0].ts_utc).toMatch(/Z$/);
  });
});
