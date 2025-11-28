/**
 * Container Executor Interface
 *
 * Abstraction for running containerized commands (Docker).
 * Allows fire modeling engines to execute in isolated containers.
 */

import { Result } from '../common/index.js';
import { EngineError } from '../../domain/errors/index.js';

/**
 * Volume mount configuration for container
 */
export interface VolumeMount {
  /** Path on the host system */
  readonly hostPath: string;
  /** Path inside the container */
  readonly containerPath: string;
  /** Mount as read-only */
  readonly readOnly?: boolean;
}

/**
 * Options for running a container command
 */
export interface ContainerRunOptions {
  /** Docker image to use (if not using docker-compose service) */
  readonly image?: string;
  /** Docker-compose service name (preferred over image) */
  readonly service?: string;
  /** Command and arguments to run */
  readonly command: string[];
  /** Volume mounts */
  readonly volumes?: VolumeMount[];
  /** Environment variables */
  readonly env?: Record<string, string>;
  /** Working directory inside container */
  readonly workingDir?: string;
  /** Timeout in milliseconds (default: 4 hours) */
  readonly timeout?: number;
  /** Project directory for docker-compose */
  readonly projectDir?: string;
}

/**
 * Result from container execution
 */
export interface ContainerResult {
  /** Exit code from the container */
  readonly exitCode: number;
  /** Standard output content */
  readonly stdout: string;
  /** Standard error content */
  readonly stderr: string;
  /** Execution duration in milliseconds */
  readonly durationMs: number;
}

/**
 * Callback for streaming output
 */
export type OutputCallback = (line: string, stream: 'stdout' | 'stderr') => void;

/**
 * Interface for container execution services.
 *
 * Implementations handle Docker or other container runtimes,
 * providing a consistent interface for running fire modeling engines.
 */
export interface IContainerExecutor {
  /**
   * Runs a command in a container and waits for completion.
   *
   * @param options - Container run configuration
   * @returns Result with container output or error
   */
  run(options: ContainerRunOptions): Promise<Result<ContainerResult, EngineError>>;

  /**
   * Runs a command in a container with streaming output.
   *
   * @param options - Container run configuration
   * @param onOutput - Callback for each output line
   * @returns Result with container output or error
   */
  runStream(
    options: ContainerRunOptions,
    onOutput: OutputCallback
  ): Promise<Result<ContainerResult, EngineError>>;

  /**
   * Checks if the container runtime is available.
   *
   * @returns True if Docker/container runtime is accessible
   */
  isAvailable(): Promise<boolean>;

  /**
   * Checks if a specific service is available (image pulled, etc.)
   *
   * @param service - Docker-compose service name
   * @returns True if the service can be started
   */
  isServiceAvailable(service: string): Promise<boolean>;
}
