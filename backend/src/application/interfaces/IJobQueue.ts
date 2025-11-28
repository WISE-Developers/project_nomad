import { Job, JobId, JobStatus, FireModelId } from '../../domain/entities/index.js';
import { DomainError, NotFoundError } from '../../domain/errors/index.js';
import { Result } from '../common/index.js';

/**
 * Interface for job queue operations.
 *
 * Manages the lifecycle of model execution jobs from creation through completion.
 * The queue handles job state transitions, status tracking, and cleanup.
 */
export interface IJobQueue {
  /**
   * Creates a new job for a model execution request.
   *
   * @param modelId - The model to execute
   * @returns The created job or an error
   */
  enqueue(modelId: FireModelId): Promise<Result<Job, DomainError>>;

  /**
   * Retrieves a job by its ID.
   *
   * @param jobId - The job to retrieve
   * @returns The job or NotFoundError
   */
  getJob(jobId: JobId): Promise<Result<Job, NotFoundError>>;

  /**
   * Updates a job's status.
   *
   * @param jobId - The job to update
   * @param status - The new status
   * @param data - Optional additional data to update
   * @returns The updated job or an error
   */
  updateStatus(
    jobId: JobId,
    status: JobStatus,
    data?: Partial<{ progress: number; error: string }>
  ): Promise<Result<Job, DomainError>>;

  /**
   * Updates a job's progress.
   *
   * @param jobId - The job to update
   * @param progress - Progress percentage (0-100)
   * @returns The updated job or an error
   */
  updateProgress(jobId: JobId, progress: number): Promise<Result<Job, DomainError>>;

  /**
   * Cancels a pending or running job.
   *
   * @param jobId - The job to cancel
   * @returns The cancelled job or an error if the job cannot be cancelled
   */
  cancel(jobId: JobId): Promise<Result<Job, DomainError>>;

  /**
   * Marks a job as failed with an error message.
   *
   * @param jobId - The job that failed
   * @param error - The error message
   * @returns The updated job or an error
   */
  fail(jobId: JobId, error: string): Promise<Result<Job, DomainError>>;

  /**
   * Marks a job as completed successfully.
   *
   * @param jobId - The job that completed
   * @returns The updated job or an error
   */
  complete(jobId: JobId): Promise<Result<Job, DomainError>>;

  /**
   * Gets all jobs in pending status.
   *
   * @returns Array of pending jobs
   */
  getQueuedJobs(): Promise<Job[]>;

  /**
   * Gets all jobs currently running.
   *
   * @returns Array of running jobs
   */
  getRunningJobs(): Promise<Job[]>;

  /**
   * Gets all jobs for a specific model.
   *
   * @param modelId - The model to find jobs for
   * @returns Array of jobs for the model
   */
  getJobsForModel(modelId: FireModelId): Promise<Job[]>;

  /**
   * Removes completed/failed jobs older than the specified date.
   *
   * @param olderThan - Remove jobs completed before this date
   * @returns Number of jobs removed
   */
  cleanup(olderThan: Date): Promise<number>;

  /**
   * Gets the total number of jobs in the queue.
   */
  getQueueLength(): Promise<number>;
}
