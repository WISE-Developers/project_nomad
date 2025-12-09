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
import { IJobQueue, IJobRepository } from '../../application/interfaces/index.js';
import { getJobRepository } from '../database/index.js';

/**
 * Database-backed job queue implementation.
 *
 * Jobs are persisted via IJobRepository, surviving backend restarts.
 * The repository implementation is determined by deployment mode (SQLite for SAN, PostgreSQL for ACN).
 * For high-volume production, consider Redis-backed queue (e.g., Bull/BullMQ).
 */
export class JobQueue implements IJobQueue {
  private get repo(): IJobRepository {
    return getJobRepository();
  }

  /**
   * Initialize the job queue, recovering from any incomplete state
   */
  async initialize(): Promise<void> {
    // Mark any running jobs as failed (they were interrupted by restart)
    const failedCount = await this.repo.markRunningAsFailed();
    if (failedCount > 0) {
      console.log(`[JobQueue] Marked ${failedCount} interrupted jobs as failed`);
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
