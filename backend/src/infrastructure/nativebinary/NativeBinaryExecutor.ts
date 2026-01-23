/**
 * Native Binary Executor Implementation
 *
 * Runs fire modeling engines as native binaries directly on the host.
 * Alternative to Docker execution for systems where the binary is installed natively.
 */

import { spawn, ChildProcess } from 'child_process';
import { constants } from 'fs';
import { access } from 'fs/promises';
import {
  IContainerExecutor,
  ContainerRunOptions,
  ContainerResult,
  OutputCallback,
} from '../../application/interfaces/IContainerExecutor.js';
import { Result } from '../../application/common/index.js';
import { EngineError } from '../../domain/errors/index.js';
import { EngineType } from '../../domain/entities/index.js';

/** Default timeout: 4 hours */
const DEFAULT_TIMEOUT_MS = 4 * 60 * 60 * 1000;

/** Grace period before SIGKILL after SIGTERM */
const KILL_GRACE_PERIOD_MS = 10000;

/**
 * Native binary executor for fire modeling engines.
 *
 * Implements IContainerExecutor interface but runs binaries directly
 * without Docker. Used when FIRESTARR_EXECUTION_MODE=binary.
 *
 * Key differences from DockerExecutor:
 * - Uses child_process.spawn() directly instead of docker compose run
 * - Binary path from FIRESTARR_BINARY_PATH env var
 * - Working directory paths are host paths (no container path mapping)
 * - No Docker socket required
 */
export class NativeBinaryExecutor implements IContainerExecutor {
  private readonly binaryPath: string;
  /** Track active processes by job ID for cancellation support */
  private readonly activeProcesses: Map<string, ChildProcess> = new Map();

  constructor(binaryPath?: string) {
    this.binaryPath = binaryPath ?? process.env.FIRESTARR_BINARY_PATH ?? '';
  }

  /**
   * Cancel a running job by its ID.
   * Sends SIGTERM followed by SIGKILL after grace period.
   * @returns true if process was found and killed, false otherwise
   */
  cancelJob(jobId: string): boolean {
    const child = this.activeProcesses.get(jobId);
    if (!child) {
      console.log(`[NativeBinaryExecutor] No active process found for job ${jobId}`);
      return false;
    }

    console.log(`[NativeBinaryExecutor] Cancelling job ${jobId}, sending SIGTERM`);
    child.kill('SIGTERM');

    // Force kill after grace period if still running
    setTimeout(() => {
      if (this.activeProcesses.has(jobId)) {
        console.log(`[NativeBinaryExecutor] Grace period expired for ${jobId}, sending SIGKILL`);
        child.kill('SIGKILL');
      }
    }, KILL_GRACE_PERIOD_MS);

    return true;
  }

  /**
   * Check if a job is currently running.
   */
  isJobRunning(jobId: string): boolean {
    return this.activeProcesses.has(jobId);
  }

  async run(options: ContainerRunOptions): Promise<Result<ContainerResult, EngineError>> {
    return this.runStream(options, () => {});
  }

  async runStream(
    options: ContainerRunOptions,
    onOutput: OutputCallback
  ): Promise<Result<ContainerResult, EngineError>> {
    const startTime = Date.now();
    const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;

    // Build the command - for native binary, command[0] is the binary path
    // and the rest are arguments
    const [binary, ...args] = options.command;

    // Use the configured binary path if the command starts with container path
    const actualBinary = binary.startsWith('/appl/') ? this.binaryPath : binary;

    if (!actualBinary) {
      return Result.fail(
        EngineError.executionFailed(
          EngineType.FireSTARR,
          'FIRESTARR_BINARY_PATH not configured for native binary execution'
        )
      );
    }

    console.log(`[NativeBinaryExecutor] Running: ${actualBinary} ${args.join(' ')}`);
    console.log(`[NativeBinaryExecutor] PROJ_DATA=${process.env.PROJ_DATA ?? '(not set)'}`);
    console.log(`[NativeBinaryExecutor] cwd=${options.workingDir ?? process.cwd()}`);

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let killed = false;
      let timeoutHandle: NodeJS.Timeout | undefined;
      let killHandle: NodeJS.Timeout | undefined;

      // For native binary, working directory is the first arg if it's a path
      // FireSTARR expects: firestarr <output_dir> <date> <lat> <lon> <time> [options]
      const cwd = options.workingDir ?? process.cwd();

      const child: ChildProcess = spawn(actualBinary, args, {
        cwd,
        env: { ...process.env, ...options.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Track process for cancellation support
      if (options.jobId) {
        this.activeProcesses.set(options.jobId, child);
      }

      // Set up timeout
      timeoutHandle = setTimeout(() => {
        console.log(`[NativeBinaryExecutor] Timeout after ${timeout}ms, sending SIGTERM`);
        killed = true;
        child.kill('SIGTERM');

        // Force kill after grace period
        killHandle = setTimeout(() => {
          console.log(`[NativeBinaryExecutor] Grace period expired, sending SIGKILL`);
          child.kill('SIGKILL');
        }, KILL_GRACE_PERIOD_MS);
      }, timeout);

      // Handle stdout
      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        stdout += text;
        const lines = text.split('\n').filter(Boolean);
        for (const line of lines) {
          onOutput(line, 'stdout');
        }
      });

      // Handle stderr
      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        stderr += text;
        const lines = text.split('\n').filter(Boolean);
        for (const line of lines) {
          onOutput(line, 'stderr');
        }
      });

      // Handle completion
      child.on('close', (code) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (killHandle) clearTimeout(killHandle);

        // Remove from active processes
        if (options.jobId) {
          this.activeProcesses.delete(options.jobId);
        }

        const durationMs = Date.now() - startTime;
        const exitCode = code ?? -1;

        console.log(`[NativeBinaryExecutor] Completed with exit code ${exitCode} in ${durationMs}ms`);

        // Log stderr on failure for debugging
        if (exitCode !== 0 && stderr) {
          console.error(`[NativeBinaryExecutor] stderr:\n${stderr}`);
        }

        if (killed) {
          resolve(
            Result.fail(
              EngineError.timeout(EngineType.FireSTARR, Math.round(timeout / 60000))
            )
          );
          return;
        }

        resolve(
          Result.ok({
            exitCode,
            stdout,
            stderr,
            durationMs,
          })
        );
      });

      // Handle spawn error
      child.on('error', (err) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (killHandle) clearTimeout(killHandle);

        // Remove from active processes
        if (options.jobId) {
          this.activeProcesses.delete(options.jobId);
        }

        console.error(`[NativeBinaryExecutor] Spawn error:`, err);

        resolve(
          Result.fail(
            EngineError.executionFailed(
              EngineType.FireSTARR,
              `Failed to spawn binary process: ${err.message}`
            )
          )
        );
      });
    });
  }

  async isAvailable(): Promise<boolean> {
    if (!this.binaryPath) {
      return false;
    }

    // Check if binary exists and is executable
    try {
      await access(this.binaryPath, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  async isServiceAvailable(_service: string): Promise<boolean> {
    // No service concept for native binary - always return true if binary is available
    return this.isAvailable();
  }
}
