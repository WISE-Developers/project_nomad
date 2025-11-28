import { FireModel, JobId, JobStatus } from '../../domain/entities/index.js';
import { DomainError, EngineError, NotFoundError } from '../../domain/errors/index.js';
import { Result } from '../common/index.js';

/**
 * Status of a model execution
 */
export interface ExecutionStatus {
  /** Job ID tracking this execution */
  jobId: JobId;
  /** Current status */
  status: JobStatus;
  /** Progress percentage (0-100) */
  progress?: number;
  /** Recent log output lines */
  logs?: string[];
}

/**
 * Options for model execution
 */
export interface ExecutionOptions {
  /** Timeout in milliseconds (default: 4 hours) */
  timeout?: number;
  /** Callback for progress updates */
  onProgress?: (progress: number) => void;
  /** Callback for log output */
  onLog?: (line: string) => void;
}

/**
 * Interface for model execution operations.
 *
 * Handles spawning and managing fire modeling engine processes.
 * Execution is asynchronous - jobs are queued and executed in the background.
 */
export interface IModelExecutionService {
  /**
   * Starts execution of a fire model.
   *
   * Creates a job, queues it, and begins execution asynchronously.
   * Returns immediately with the job ID for status tracking.
   *
   * @param model - The model to execute
   * @param options - Execution options
   * @returns Job ID for tracking, or an error
   */
  execute(model: FireModel, options?: ExecutionOptions): Promise<Result<JobId, EngineError>>;

  /**
   * Gets the current execution status for a job.
   *
   * @param jobId - The job to check
   * @returns Execution status or NotFoundError
   */
  getStatus(jobId: JobId): Promise<Result<ExecutionStatus, NotFoundError>>;

  /**
   * Cancels a running or pending execution.
   *
   * If the process is running, sends SIGTERM and waits for cleanup.
   *
   * @param jobId - The job to cancel
   * @returns Success or an error
   */
  cancel(jobId: JobId): Promise<Result<void, DomainError>>;

  /**
   * Checks if a specific engine type is available for execution.
   *
   * @param engineType - The engine to check
   * @returns true if the engine is available
   */
  isEngineAvailable(engineType: string): Promise<boolean>;
}
