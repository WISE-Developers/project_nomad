import { FireModelId } from './FireModel.js';
import { ModelResultId } from './ModelResult.js';

/**
 * Branded type for Job IDs to provide type-safe identification
 */
declare const JobIdBrand: unique symbol;
export type JobId = string & { readonly [JobIdBrand]: typeof JobIdBrand };

/**
 * Creates a JobId from a string
 */
export function createJobId(id: string): JobId {
  if (!id || id.trim().length === 0) {
    throw new Error('JobId cannot be empty');
  }
  return id as JobId;
}

/**
 * Status of a job throughout its lifecycle
 */
export enum JobStatus {
  /** Waiting in queue to be processed */
  Pending = 'pending',
  /** Currently being executed */
  Running = 'running',
  /** Execution completed successfully */
  Completed = 'completed',
  /** Execution failed */
  Failed = 'failed',
  /** Cancelled by user */
  Cancelled = 'cancelled',
}

/**
 * Properties required to create a Job
 */
export interface JobProps {
  readonly id: JobId;
  readonly modelId: FireModelId;
  readonly status?: JobStatus;
  readonly progress?: number;
  readonly createdAt?: Date;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly error?: string;
  readonly resultIds?: ModelResultId[];
}

/**
 * Entity representing a model execution job.
 *
 * Jobs track the lifecycle of model execution requests,
 * from queueing through completion or failure.
 */
export class Job {
  /** Unique identifier for this job */
  readonly id: JobId;

  /** Reference to the model being executed */
  readonly modelId: FireModelId;

  /** Current status in the execution lifecycle */
  readonly status: JobStatus;

  /** Execution progress (0-100) */
  readonly progress: number;

  /** When this job was created (queued) */
  readonly createdAt: Date;

  /** When execution started */
  readonly startedAt?: Date;

  /** When execution completed (success, failure, or cancellation) */
  readonly completedAt?: Date;

  /** Error message if execution failed */
  readonly error?: string;

  /** IDs of results produced by this job */
  readonly resultIds: ModelResultId[];

  constructor(props: JobProps) {
    this.id = props.id;
    this.modelId = props.modelId;
    this.status = props.status ?? JobStatus.Pending;
    this.progress = props.progress ?? 0;
    this.createdAt = props.createdAt ?? new Date();
    this.startedAt = props.startedAt;
    this.completedAt = props.completedAt;
    this.error = props.error;
    this.resultIds = props.resultIds ?? [];
  }

  /**
   * Creates a new Job with updated status
   */
  withStatus(status: JobStatus): Job {
    const shouldSetStartedAt = status === JobStatus.Running && !this.startedAt;
    const shouldSetCompletedAt = this.isTerminalStatus(status);
    console.log(`[Job.withStatus] ${this.id}: ${this.status} -> ${status}, shouldSetStartedAt=${shouldSetStartedAt}, shouldSetCompletedAt=${shouldSetCompletedAt}`);

    const newJob = new Job({
      ...this.toProps(),
      status,
      ...(shouldSetStartedAt && { startedAt: new Date() }),
      ...(shouldSetCompletedAt && { completedAt: new Date() }),
    });

    console.log(`[Job.withStatus] ${this.id}: startedAt=${newJob.startedAt?.toISOString()}, completedAt=${newJob.completedAt?.toISOString()}`);
    return newJob;
  }

  /**
   * Creates a new Job with updated progress
   */
  withProgress(progress: number): Job {
    return new Job({
      ...this.toProps(),
      progress: Math.min(100, Math.max(0, progress)),
    });
  }

  /**
   * Creates a new Job marked as failed
   */
  withError(error: string): Job {
    return new Job({
      ...this.toProps(),
      status: JobStatus.Failed,
      error,
      completedAt: new Date(),
    });
  }

  /**
   * Creates a new Job with added result ID
   */
  withResult(resultId: ModelResultId): Job {
    return new Job({
      ...this.toProps(),
      resultIds: [...this.resultIds, resultId],
    });
  }

  /**
   * Check if the job can be cancelled
   */
  canCancel(): boolean {
    return this.status === JobStatus.Pending || this.status === JobStatus.Running;
  }

  /**
   * Check if the job is in a terminal state
   */
  isTerminal(): boolean {
    return this.isTerminalStatus(this.status);
  }

  /**
   * Get duration in milliseconds (if started)
   */
  getDuration(): number | undefined {
    if (!this.startedAt) return undefined;
    const endTime = this.completedAt ?? new Date();
    return endTime.getTime() - this.startedAt.getTime();
  }

  /**
   * Convert to plain object for serialization
   */
  toJSON(): {
    id: string;
    modelId: string;
    status: JobStatus;
    progress: number;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
    error?: string;
    resultIds: string[];
  } {
    return {
      id: this.id,
      modelId: this.modelId,
      status: this.status,
      progress: this.progress,
      createdAt: this.createdAt.toISOString(),
      ...(this.startedAt && { startedAt: this.startedAt.toISOString() }),
      ...(this.completedAt && { completedAt: this.completedAt.toISOString() }),
      ...(this.error && { error: this.error }),
      resultIds: this.resultIds,
    };
  }

  private isTerminalStatus(status: JobStatus): boolean {
    return [JobStatus.Completed, JobStatus.Failed, JobStatus.Cancelled].includes(status);
  }

  private toProps(): JobProps {
    return {
      id: this.id,
      modelId: this.modelId,
      status: this.status,
      progress: this.progress,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      error: this.error,
      resultIds: this.resultIds,
    };
  }
}
