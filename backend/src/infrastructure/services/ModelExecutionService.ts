import { ChildProcess, spawn } from 'child_process';
import {
  FireModel,
  JobId,
  JobStatus,
  EngineType,
} from '../../domain/entities/index.js';
import { DomainError, EngineError, NotFoundError } from '../../domain/errors/index.js';
import { Result } from '../../application/common/index.js';
import {
  IModelExecutionService,
  ExecutionStatus,
  ExecutionOptions,
} from '../../application/interfaces/IModelExecutionService.js';
import { IJobQueue } from '../../application/interfaces/IJobQueue.js';
import { getJobQueue } from './JobQueue.js';
import { getDockerExecutor } from '../docker/index.js';

/** Default execution timeout: 4 hours */
const DEFAULT_TIMEOUT_MS = 4 * 60 * 60 * 1000;

/** Maximum log lines to keep in memory per job */
const MAX_LOG_LINES = 100;

/**
 * Tracks a running execution process
 */
interface ExecutionProcess {
  process: ChildProcess;
  logs: string[];
  timeout?: NodeJS.Timeout;
}

/**
 * Model execution service implementation.
 *
 * Manages fire model execution by spawning child processes
 * and tracking their status through the job queue.
 */
export class ModelExecutionService implements IModelExecutionService {
  private processes: Map<string, ExecutionProcess> = new Map();
  private jobQueue: IJobQueue;

  constructor(jobQueue?: IJobQueue) {
    this.jobQueue = jobQueue ?? getJobQueue();
  }

  async execute(
    model: FireModel,
    options?: ExecutionOptions
  ): Promise<Result<JobId, EngineError>> {
    // Validate engine is available
    const engineAvailable = await this.isEngineAvailable(model.engineType);
    if (!engineAvailable) {
      return Result.fail(
        EngineError.unavailable(model.engineType, 'Engine not configured')
      );
    }

    // Create job in queue
    const jobResult = await this.jobQueue.enqueue(model.id);
    if (!jobResult.success) {
      return Result.fail(
        EngineError.initializationFailed(
          model.engineType,
          `Failed to create job: ${jobResult.error.message}`
        )
      );
    }

    const jobId = jobResult.value.id;
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;

    // Start execution asynchronously
    this.startExecution(jobId, model, timeout, options).catch((err) => {
      console.error(`[ExecutionService] Unexpected error in job ${jobId}:`, err);
      this.jobQueue.fail(jobId, `Unexpected error: ${err.message}`);
    });

    return Result.ok(jobId);
  }

  async getStatus(jobId: JobId): Promise<Result<ExecutionStatus, NotFoundError>> {
    const jobResult = await this.jobQueue.getJob(jobId);
    if (!jobResult.success) {
      return Result.fail(jobResult.error);
    }

    const job = jobResult.value;
    const execution = this.processes.get(jobId);

    return Result.ok({
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      logs: execution?.logs ?? [],
    });
  }

  async cancel(jobId: JobId): Promise<Result<void, DomainError>> {
    const execution = this.processes.get(jobId);

    // Kill the process if running
    if (execution) {
      if (execution.timeout) {
        clearTimeout(execution.timeout);
      }
      execution.process.kill('SIGTERM');
      this.processes.delete(jobId);
    }

    // Update job status
    const cancelResult = await this.jobQueue.cancel(jobId);
    if (!cancelResult.success) {
      return Result.fail(cancelResult.error);
    }

    return Result.ok(undefined);
  }

  async isEngineAvailable(engineType: string): Promise<boolean> {
    switch (engineType) {
      case EngineType.FireSTARR: {
        // Check if Docker is available
        const dockerExecutor = getDockerExecutor();
        const dockerAvailable = await dockerExecutor.isAvailable();
        if (!dockerAvailable) {
          console.warn('[ExecutionService] Docker not available for FireSTARR');
          return false;
        }

        // Check if the FireSTARR service is available
        const serviceAvailable = await dockerExecutor.isServiceAvailable('firestarr-app');
        if (!serviceAvailable) {
          console.warn('[ExecutionService] FireSTARR Docker service not available');
          // For development, still return true to allow stub execution
          return true;
        }

        return true;
      }

      case EngineType.WISE:
        // WISE not yet implemented - allow stub execution
        console.warn('[ExecutionService] WISE engine not yet implemented, using stub');
        return true;

      default:
        return false;
    }
  }

  /**
   * Starts the actual execution process
   */
  private async startExecution(
    jobId: JobId,
    model: FireModel,
    timeout: number,
    options?: ExecutionOptions
  ): Promise<void> {
    // Mark job as running
    await this.jobQueue.updateStatus(jobId, JobStatus.Running);

    // Get the command for this engine type
    const command = this.getEngineCommand(model);

    console.log(`[ExecutionService] Starting job ${jobId}: ${command.cmd} ${command.args.join(' ')}`);

    // Spawn the process
    const childProcess = spawn(command.cmd, command.args, {
      cwd: command.cwd,
      env: { ...process.env, ...command.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const logs: string[] = [];

    // Store process reference
    const execution: ExecutionProcess = {
      process: childProcess,
      logs,
    };
    this.processes.set(jobId, execution);

    // Set up timeout
    execution.timeout = setTimeout(async () => {
      console.log(`[ExecutionService] Job ${jobId} timed out`);
      childProcess.kill('SIGTERM');
      await this.jobQueue.fail(jobId, `Execution timed out after ${timeout / 1000} seconds`);
      this.processes.delete(jobId);
    }, timeout);

    // Handle stdout
    childProcess.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        this.addLog(execution, line);
        options?.onLog?.(line);
        this.parseProgress(line, jobId, options);
      }
    });

    // Handle stderr
    childProcess.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        this.addLog(execution, `[stderr] ${line}`);
        options?.onLog?.(`[stderr] ${line}`);
      }
    });

    // Handle process exit
    childProcess.on('close', async (code) => {
      if (execution.timeout) {
        clearTimeout(execution.timeout);
      }
      this.processes.delete(jobId);

      if (code === 0) {
        console.log(`[ExecutionService] Job ${jobId} completed successfully`);
        await this.jobQueue.complete(jobId);
      } else {
        console.log(`[ExecutionService] Job ${jobId} failed with exit code ${code}`);
        await this.jobQueue.fail(jobId, `Process exited with code ${code}`);
      }
    });

    // Handle process error
    childProcess.on('error', async (err) => {
      if (execution.timeout) {
        clearTimeout(execution.timeout);
      }
      this.processes.delete(jobId);

      console.error(`[ExecutionService] Job ${jobId} error:`, err);
      await this.jobQueue.fail(jobId, `Process error: ${err.message}`);
    });
  }

  /**
   * Gets the command to execute for a given model.
   *
   * For FireSTARR with Docker available, returns docker compose command.
   * Otherwise, returns stub command for development.
   */
  private getEngineCommand(model: FireModel): {
    cmd: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
  } {
    switch (model.engineType) {
      case EngineType.FireSTARR:
        // Check if we should use real Docker execution
        // For now, use stub - real execution is via FireSTARREngine directly
        // The ModelExecutionService stub path is kept for backwards compatibility
        // and for when Docker is not available
        //
        // To use real FireSTARR execution:
        // 1. Call getFireSTARREngine().initialize(model, options)
        // 2. Call getFireSTARREngine().execute(modelId)
        // 3. Poll getFireSTARREngine().getStatus(modelId) for progress
        //
        // For now, use a stub that simulates execution
        return {
          cmd: 'sh',
          args: [
            '-c',
            `echo "Starting FireSTARR simulation for model ${model.id}..." && ` +
            `echo "[NOTE] Using stub execution - Docker not connected" && ` +
            `sleep 1 && echo "Running scenario 1 of 10" && ` +
            `sleep 1 && echo "Running scenario 5 of 10" && ` +
            `sleep 1 && echo "Running scenario 10 of 10" && ` +
            `sleep 1 && echo "Total simulation time was 4.0 seconds" && ` +
            `echo "Simulation complete"`,
          ],
        };

      case EngineType.WISE:
        // WISE not yet implemented - use stub
        return {
          cmd: 'sh',
          args: [
            '-c',
            `echo "Starting WISE simulation for model ${model.id}..." && ` +
            `echo "[NOTE] WISE engine not yet implemented" && ` +
            `sleep 1 && echo "Progress: 25%" && ` +
            `sleep 1 && echo "Progress: 50%" && ` +
            `sleep 1 && echo "Progress: 75%" && ` +
            `sleep 1 && echo "Progress: 100%" && ` +
            `echo "Simulation complete"`,
          ],
        };

      default:
        return {
          cmd: 'echo',
          args: [`Unknown engine type: ${model.engineType}`],
        };
    }
  }

  /**
   * Adds a log line, keeping only the most recent lines
   */
  private addLog(execution: ExecutionProcess, line: string): void {
    execution.logs.push(line);
    if (execution.logs.length > MAX_LOG_LINES) {
      execution.logs.shift();
    }
  }

  /**
   * Parses progress from log output
   */
  private parseProgress(line: string, jobId: JobId, options?: ExecutionOptions): void {
    // Look for "Progress: XX%" pattern
    let match = line.match(/Progress:\s*(\d+)%/i);
    if (match) {
      const progress = parseInt(match[1], 10);
      this.jobQueue.updateProgress(jobId, progress);
      options?.onProgress?.(progress);
      return;
    }

    // Look for FireSTARR "Running scenario X of Y" pattern
    match = line.match(/Running scenario (\d+) of (\d+)/);
    if (match) {
      const current = parseInt(match[1], 10);
      const total = parseInt(match[2], 10);
      const progress = Math.round((current / total) * 100);
      this.jobQueue.updateProgress(jobId, progress);
      options?.onProgress?.(progress);
    }
  }
}

/**
 * Singleton instance
 */
let instance: ModelExecutionService | null = null;

export function getModelExecutionService(): IModelExecutionService {
  if (!instance) {
    instance = new ModelExecutionService();
  }
  return instance;
}

export function resetModelExecutionService(): void {
  instance = null;
}
