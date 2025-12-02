import { Job, JobId, JobStatus, FireModelId } from '../../domain/entities/index.js';

/**
 * Interface for job persistence.
 *
 * Handles storage and retrieval of execution jobs.
 * Implementations may use SQLite (SAN mode) or PostgreSQL (ACN mode).
 */
export interface IJobRepository {
  /**
   * Saves a new job.
   *
   * @param job - Job to save
   * @returns Saved job
   */
  save(job: Job): Promise<Job>;

  /**
   * Updates an existing job.
   *
   * @param job - Job to update
   * @returns Updated job
   */
  update(job: Job): Promise<Job>;

  /**
   * Finds a job by ID.
   *
   * @param id - Job ID
   * @returns Job if found, null otherwise
   */
  findById(id: JobId): Promise<Job | null>;

  /**
   * Finds jobs by status.
   *
   * @param status - Status to filter by
   * @returns Jobs with the given status
   */
  findByStatus(status: JobStatus): Promise<Job[]>;

  /**
   * Finds all jobs for a model.
   *
   * @param modelId - Model ID
   * @returns Jobs for the model
   */
  findByModelId(modelId: FireModelId): Promise<Job[]>;

  /**
   * Gets all jobs.
   *
   * @returns All jobs
   */
  findAll(): Promise<Job[]>;

  /**
   * Deletes a job by ID.
   *
   * @param id - Job ID
   * @returns Whether deletion succeeded
   */
  delete(id: JobId): Promise<boolean>;

  /**
   * Checks if a job exists.
   *
   * @param id - Job ID
   * @returns Whether job exists
   */
  exists(id: JobId): Promise<boolean>;

  /**
   * Marks all running jobs as failed.
   * Used for startup recovery after unclean shutdown.
   *
   * @returns Number of jobs marked as failed
   */
  markRunningAsFailed(): Promise<number>;

  /**
   * Deletes jobs older than the specified date.
   *
   * @param olderThan - Delete jobs completed before this date
   * @returns Number of deleted jobs
   */
  deleteOlderThan(olderThan: Date): Promise<number>;

  /**
   * Deletes all jobs for a model.
   *
   * @param modelId - Model ID
   * @returns Number of deleted jobs
   */
  deleteByModelId(modelId: FireModelId): Promise<number>;
}
