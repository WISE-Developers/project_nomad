import { v4 as uuidv4 } from 'uuid';
import {
  Job,
  JobId,
  JobStatus,
  FireModelId,
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
   * Initialize the job queue, recovering from any incomplete state
   */
  async initialize(): Promise<void> {
    // Capture the interrupted jobs BEFORE marking them, so each one can be
    // recorded individually. markRunningAsFailed returns only a count.
    const interrupted = await this.repo.findByStatus(JobStatus.Running);

    // Mark any running jobs as failed (they were interrupted by restart)
    const failedCount = await this.repo.markRunningAsFailed();
    if (failedCount > 0) {
      console.log(`[JobQueue] Marked ${failedCount} interrupted jobs as failed`);
    }

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

  async enqueue(modelId: FireModelId): Promise<Result<Job, DomainError>> {
    const jobId = createJobId(uuidv4());
    const job = new Job({
      id: jobId,
      modelId,
      status: JobStatus.Pending,
    });

    await this.repo.save(job);
    console.log(`[JobQueue] Job ${jobId} created for model ${modelId}`);

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
    await this.repo.update(updated);
    console.log(`[JobQueue] Job ${jobId} status updated to ${status}`);

    // Only the Pending -> Running transition is a run starting. Re-entering
    // Running (progress updates arrive via updateProgress) must not double-count.
    if (status === JobStatus.Running && existing.status !== JobStatus.Running) {
      await this.recordRun('model.run.started', updated.modelId);
    }

    return Result.ok(updated);
  }

  async updateProgress(jobId: JobId, progress: number): Promise<Result<Job, DomainError>> {
    const existing = await this.repo.findById(jobId);
    if (!existing) {
      return Result.fail(new NotFoundError('Job', jobId));
    }

    const updated = existing.withProgress(progress);
    await this.repo.update(updated);

    return Result.ok(updated);
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

    const cancelled = existing.withStatus(JobStatus.Cancelled);
    await this.repo.update(cancelled);
    console.log(`[JobQueue] Job ${jobId} cancelled`);

    return Result.ok(cancelled);
  }

  async fail(jobId: JobId, error: string): Promise<Result<Job, DomainError>> {
    const existing = await this.repo.findById(jobId);
    if (!existing) {
      return Result.fail(new NotFoundError('Job', jobId));
    }

    const failed = existing.withError(error);
    await this.repo.update(failed);
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
    await this.repo.update(completed);
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
