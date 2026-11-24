import { v4 as uuidv4 } from 'uuid';
import {
  Job,
  JobId,
  JobStatus,
  FireModelId,
  ModelStatus,
  createJobId,
} from '../../domain/entities/index.js';
import { DomainError, NotFoundError, ValidationError } from '../../domain/errors/index.js';
import { Result } from '../../application/common/index.js';
import { IJobQueue, IJobRepository, IModelRepository } from '../../application/interfaces/index.js';
import { IUsageLogger } from '../../application/interfaces/IUsageLogger.js';
import { getJobRepository, getModelRepository } from '../database/index.js';
import { getUsageLogger } from '../usage/index.js';
import { EnvironmentService } from '../config/EnvironmentService.js';
import { resolveAuthMode } from '../../api/middleware/authMode.js';
import { createUsageEvent, SINGLE_USER, UNKNOWN_USER } from '../../application/usage/usageEvent.js';
import type { UsageEventType, AuthMode } from '../../domain/value-objects/UsageEvent.js';

/**
 * Collaborators, injectable for testing. Each falls back to the process-wide
 * instance, so existing call sites are unchanged.
 */
/**
 * Wall-clock duration between two job timestamps, or null when either is
 * missing. Null rather than 0: "we did not record this" and "it took no time"
 * are different facts and must not collapse into the same number.
 */
function elapsedSeconds(startedAt?: Date, completedAt?: Date): number | null {
  if (!startedAt) return null;
  const end = completedAt ?? new Date();
  return Math.round((end.getTime() - startedAt.getTime()) / 1000);
}

export interface JobQueueDeps {
  jobRepository?: IJobRepository;
  modelRepository?: IModelRepository;
  usageLogger?: IUsageLogger;
  homeTimezone?: string;
  authMode?: AuthMode;
}

/**
 * Database-backed job queue implementation.
 *
 * Jobs are persisted via IJobRepository, surviving backend restarts.
 * The repository implementation is determined by deployment mode (SQLite for SAN, PostgreSQL for ACN).
 * For high-volume production, consider Redis-backed queue (e.g., Bull/BullMQ).
 */
export class JobQueue implements IJobQueue {
  constructor(private readonly deps: JobQueueDeps = {}) {}

  private get repo(): IJobRepository {
    return this.deps.jobRepository ?? getJobRepository();
  }

  private get modelRepo(): IModelRepository {
    return this.deps.modelRepository ?? getModelRepository();
  }

  /**
   * Resolves who a run belongs to.
   *
   * Ownership is read from the job's model (fire_models.user_id, added in
   * migration 002) rather than stored again on the job. Two copies of an owner
   * is how they end up disagreeing - and reading through the model also works
   * after a restart, which is what lets interrupted runs keep their attribution.
   */
  private async resolveRunActor(modelId: FireModelId): Promise<string> {
    const authMode = this.deps.authMode ?? resolveAuthMode();

    let userId: string | undefined;
    try {
      const model = await this.modelRepo.findById(modelId);
      userId = model?.userId;
    } catch {
      // A lookup failure must not fail the job. Fall through to the unknown
      // actor rather than guessing.
      userId = undefined;
    }

    if (userId) return userId;
    // In none mode there is genuinely one assumed user; elsewhere the absence
    // of an owner is a gap, and the log should say so rather than imply a name.
    return authMode === 'none' ? SINGLE_USER : UNKNOWN_USER;
  }

  /** Emits a usage event. Never throws - a run must not fail over its log. */
  private async recordRun(
    type: UsageEventType,
    modelId: FireModelId,
    detail?: Record<string, unknown>
  ): Promise<void> {
    try {
      const zone =
        this.deps.homeTimezone ?? EnvironmentService.getInstance().getHomeTimezone();
      const event = createUsageEvent({
        type,
        actor: await this.resolveRunActor(modelId),
        zone,
        now: new Date(),
        modelId,
        detail,
      });
      await (this.deps.usageLogger ?? getUsageLogger()).record(event);
    } catch {
      // Swallowed here by design; the adapter logs its own write failures.
    }
  }

  /**
   * Startup recovery. Called once from initializeDatabaseLayer in index.ts, before the
   * server listens, so no request or run is in flight.
   *
   * The process that drove every unfinished run is gone and nothing resumes runs, so:
   *   1. every pending or running job is failed. Pending ones too: on
   *      POST /models/:id/execute a job stays pending for the whole of engine
   *      initialization, and a pending job nobody will pick up waits forever (F2);
   *   2. every model still queued or running - or still draft but with a job, which is
   *      the MCP path, since it never writes queued - takes the outcome of its latest
   *      job. A model the job layer had finished (job completed, crash before the model
   *      write) is completed, not failed; a model with no job at all is failed (F3).
   */
  async initialize(): Promise<void> {
    // Capture the interrupted jobs BEFORE marking them, so each one can be
    // recorded individually. failInterrupted returns only a count.
    const interrupted = [
      ...(await this.repo.findByStatus(JobStatus.Pending)),
      ...(await this.repo.findByStatus(JobStatus.Running)),
    ];

    const failedCount = await this.repo.failInterrupted();
    if (failedCount > 0) {
      console.log(`[JobQueue] Marked ${failedCount} interrupted jobs as failed`);
    }

    await this.reconcileInterruptedModels();

    // These failures happen at boot with no request in flight and no in-memory
    // engine state - the reason run events are emitted here and not from the
    // engine. Without this they would vanish from the record entirely.
    for (const job of interrupted) {
      await this.recordRun('model.run.failed', job.modelId, {
        reason: 'Interrupted by restart',
        interrupted_by_restart: true,
      });
    }
  }

  /** Step 2 of initialize(). */
  private async reconcileInterruptedModels(): Promise<void> {
    const { models } = await this.modelRepo.find({
      status: [ModelStatus.Queued, ModelStatus.Running, ModelStatus.Draft],
    });

    for (const model of models) {
      // findByModelId is newest first.
      const [latest] = await this.repo.findByModelId(model.id);
      if (model.status === ModelStatus.Draft && !latest) continue;

      const outcome =
        latest?.status === JobStatus.Completed
          ? ModelStatus.Completed
          : latest?.status === JobStatus.Cancelled
            ? ModelStatus.Cancelled
            : ModelStatus.Failed;
      await this.modelRepo.updateStatus(model.id, outcome);
      console.log(`[JobQueue] Model ${model.id} was ${model.status} at restart; now ${outcome}`);
    }
  }

  /**
   * Writes a job through updateIfActive, so a completed, failed or cancelled job is
   * never overwritten. When the stored job is already final, answers with why.
   */
  private async writeIfActive(updated: Job): Promise<Result<Job, DomainError>> {
    if (await this.repo.updateIfActive(updated)) {
      return Result.ok(updated);
    }
    const current = await this.repo.findById(updated.id);
    if (!current) {
      return Result.fail(new NotFoundError('Job', updated.id));
    }
    return Result.fail(
      new ValidationError(`Job is already ${current.status}`, [
        { field: 'status', message: `Job is already ${current.status}` },
      ])
    );
  }

  async enqueue(modelId: FireModelId): Promise<Result<Job, DomainError>> {
    const jobId = createJobId(uuidv4());
    const job = new Job({
      id: jobId,
      modelId,
      status: JobStatus.Pending,
    });

    await this.repo.save(job);
    console.log(`[JobQueue] Job ${jobId} created for model ${modelId}`);

    // Emitted here rather than on Pending -> Running: a run that dies during
    // input generation never reaches Running, so emitting there produced a
    // model.run.failed with no matching start, and failed/started could exceed
    // 100%. Observed in a real deployment - a missing SpotWX key emitted a
    // failure alone. "Started" therefore means "a run was requested".
    await this.recordRun('model.run.started', modelId);

    return Result.ok(job);
  }

  async getJob(jobId: JobId): Promise<Result<Job, NotFoundError>> {
    const job = await this.repo.findById(jobId);
    if (!job) {
      return Result.fail(new NotFoundError('Job', jobId));
    }
    return Result.ok(job);
  }

  async updateStatus(
    jobId: JobId,
    status: JobStatus,
    data?: Partial<{ progress: number; error: string }>
  ): Promise<Result<Job, DomainError>> {
    const existing = await this.repo.findById(jobId);
    if (!existing) {
      console.error(`[JobQueue.updateStatus] Job ${jobId} not found!`);
      return Result.fail(new NotFoundError('Job', jobId));
    }

    console.log(`[JobQueue.updateStatus] Found job ${jobId}: status=${existing.status}, startedAt=${existing.startedAt?.toISOString()}`);

    let updated = existing.withStatus(status);

    if (data?.progress !== undefined) {
      updated = updated.withProgress(data.progress);
    }

    if (data?.error !== undefined) {
      updated = new Job({
        id: updated.id,
        modelId: updated.modelId,
        status: updated.status,
        progress: updated.progress,
        createdAt: updated.createdAt,
        startedAt: updated.startedAt,
        completedAt: updated.completedAt,
        error: data.error,
        resultIds: updated.resultIds,
      });
    }

    console.log(`[JobQueue.updateStatus] Saving job ${jobId}: status=${updated.status}, startedAt=${updated.startedAt?.toISOString()}, completedAt=${updated.completedAt?.toISOString()}`);
    const written = await this.writeIfActive(updated);
    if (!written.success) return written;
    console.log(`[JobQueue] Job ${jobId} status updated to ${status}`);

    // No event here: model.run.started is emitted at enqueue so that every run
    // has exactly one start, including runs that fail before reaching Running.

    return written;
  }

  async updateProgress(jobId: JobId, progress: number): Promise<Result<Job, DomainError>> {
    const existing = await this.repo.findById(jobId);
    if (!existing) {
      return Result.fail(new NotFoundError('Job', jobId));
    }

    return this.writeIfActive(existing.withProgress(progress));
  }

  async cancel(jobId: JobId): Promise<Result<Job, DomainError>> {
    const existing = await this.repo.findById(jobId);
    if (!existing) {
      return Result.fail(new NotFoundError('Job', jobId));
    }

    if (!existing.canCancel()) {
      return Result.fail(
        new ValidationError(`Job cannot be cancelled - status is ${existing.status}`, [
          { field: 'status', message: `Job is already ${existing.status}` },
        ])
      );
    }

    // canCancel() above read the status; the run can still finish before this write
    // lands, and then updateIfActive refuses it rather than overwriting the result.
    const written = await this.writeIfActive(existing.withStatus(JobStatus.Cancelled));
    if (written.success) console.log(`[JobQueue] Job ${jobId} cancelled`);
    return written;
  }

  async fail(jobId: JobId, error: string): Promise<Result<Job, DomainError>> {
    const existing = await this.repo.findById(jobId);
    if (!existing) {
      return Result.fail(new NotFoundError('Job', jobId));
    }

    const failed = existing.withError(error);
    const written = await this.writeIfActive(failed);
    if (!written.success) return written;
    console.log(`[JobQueue] Job ${jobId} failed: ${error}`);

    await this.recordRun('model.run.failed', failed.modelId, {
      reason: error,
      wall_clock_seconds: elapsedSeconds(failed.startedAt, failed.completedAt),
    });

    return Result.ok(failed);
  }

  async complete(jobId: JobId): Promise<Result<Job, DomainError>> {
    const existing = await this.repo.findById(jobId);
    if (!existing) {
      return Result.fail(new NotFoundError('Job', jobId));
    }

    const completed = existing.withStatus(JobStatus.Completed).withProgress(100);
    const written = await this.writeIfActive(completed);
    if (!written.success) return written;
    console.log(`[JobQueue] Job ${jobId} completed`);

    // Wall clock, which includes container startup. FireSTARR's own
    // summary.durationSeconds is a different number and is recorded by the
    // engine; both are wanted, and conflating them would misreport capacity.
    await this.recordRun('model.run.completed', completed.modelId, {
      wall_clock_seconds: elapsedSeconds(completed.startedAt, completed.completedAt),
    });

    return Result.ok(completed);
  }

  async getQueuedJobs(): Promise<Job[]> {
    return this.repo.findByStatus(JobStatus.Pending);
  }

  async getRunningJobs(): Promise<Job[]> {
    return this.repo.findByStatus(JobStatus.Running);
  }

  async getJobsForModel(modelId: FireModelId): Promise<Job[]> {
    return this.repo.findByModelId(modelId);
  }

  async cleanup(olderThan: Date): Promise<number> {
    return this.repo.deleteOlderThan(olderThan);
  }

  async getQueueLength(): Promise<number> {
    const jobs = await this.repo.findAll();
    return jobs.length;
  }
}

/**
 * Singleton instance of the job queue.
 * In production, this would be replaced with a distributed queue.
 */
let instance: JobQueue | null = null;

export function getJobQueue(): IJobQueue {
  if (!instance) {
    instance = new JobQueue();
  }
  return instance;
}

/**
 * Resets the job queue (useful for testing)
 */
export function resetJobQueue(): void {
  instance = null;
}
