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
import { IJobQueue } from '../../application/interfaces/IJobQueue.js';

/**
 * In-memory job queue implementation.
 *
 * Suitable for MVP/single-server deployment.
 * For production, consider replacing with Redis-backed queue (e.g., Bull/BullMQ).
 */
export class JobQueue implements IJobQueue {
  private jobs: Map<JobId, Job> = new Map();

  async enqueue(modelId: FireModelId): Promise<Result<Job, DomainError>> {
    const jobId = createJobId(uuidv4());
    const job = new Job({
      id: jobId,
      modelId,
      status: JobStatus.Pending,
    });

    this.jobs.set(jobId, job);
    console.log(`[JobQueue] Job ${jobId} created for model ${modelId}`);

    return Result.ok(job);
  }

  async getJob(jobId: JobId): Promise<Result<Job, NotFoundError>> {
    const job = this.jobs.get(jobId);
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
    const existing = this.jobs.get(jobId);
    if (!existing) {
      return Result.fail(new NotFoundError('Job', jobId));
    }

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

    this.jobs.set(jobId, updated);
    console.log(`[JobQueue] Job ${jobId} status updated to ${status}`);

    return Result.ok(updated);
  }

  async updateProgress(jobId: JobId, progress: number): Promise<Result<Job, DomainError>> {
    const existing = this.jobs.get(jobId);
    if (!existing) {
      return Result.fail(new NotFoundError('Job', jobId));
    }

    const updated = existing.withProgress(progress);
    this.jobs.set(jobId, updated);

    return Result.ok(updated);
  }

  async cancel(jobId: JobId): Promise<Result<Job, DomainError>> {
    const existing = this.jobs.get(jobId);
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
    this.jobs.set(jobId, cancelled);
    console.log(`[JobQueue] Job ${jobId} cancelled`);

    return Result.ok(cancelled);
  }

  async fail(jobId: JobId, error: string): Promise<Result<Job, DomainError>> {
    const existing = this.jobs.get(jobId);
    if (!existing) {
      return Result.fail(new NotFoundError('Job', jobId));
    }

    const failed = existing.withError(error);
    this.jobs.set(jobId, failed);
    console.log(`[JobQueue] Job ${jobId} failed: ${error}`);

    return Result.ok(failed);
  }

  async complete(jobId: JobId): Promise<Result<Job, DomainError>> {
    const existing = this.jobs.get(jobId);
    if (!existing) {
      return Result.fail(new NotFoundError('Job', jobId));
    }

    const completed = existing.withStatus(JobStatus.Completed).withProgress(100);
    this.jobs.set(jobId, completed);
    console.log(`[JobQueue] Job ${jobId} completed`);

    return Result.ok(completed);
  }

  async getQueuedJobs(): Promise<Job[]> {
    return Array.from(this.jobs.values()).filter(
      (job) => job.status === JobStatus.Pending
    );
  }

  async getRunningJobs(): Promise<Job[]> {
    return Array.from(this.jobs.values()).filter(
      (job) => job.status === JobStatus.Running
    );
  }

  async getJobsForModel(modelId: FireModelId): Promise<Job[]> {
    return Array.from(this.jobs.values()).filter(
      (job) => job.modelId === modelId
    );
  }

  async cleanup(olderThan: Date): Promise<number> {
    let removed = 0;
    for (const [jobId, job] of this.jobs.entries()) {
      if (job.isTerminal() && job.completedAt && job.completedAt < olderThan) {
        this.jobs.delete(jobId);
        removed++;
      }
    }
    if (removed > 0) {
      console.log(`[JobQueue] Cleaned up ${removed} old jobs`);
    }
    return removed;
  }

  async getQueueLength(): Promise<number> {
    return this.jobs.size;
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
