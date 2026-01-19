/**
 * Docker Executor Implementation
 *
 * Runs containerized commands via docker-compose.
 * Used primarily for fire modeling engine execution.
 */

import { spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
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
 * Docker-based container executor.
 *
 * Uses docker-compose to run commands in containers,
 * with support for volume mounts, environment variables,
 * streaming output, and timeout handling.
 */
export class DockerExecutor implements IContainerExecutor {
  private readonly projectDir: string;
  /** Track active processes by job ID for cancellation support */
  private readonly activeProcesses: Map<string, ChildProcess> = new Map();

  constructor(projectDir?: string) {
    // Default to parent of backend (project root)
    this.projectDir = projectDir ?? process.cwd().replace(/\/backend$/, '');
  }

  /**
   * Cancel a running job by its ID.
   * Sends SIGTERM followed by SIGKILL after grace period.
   * @returns true if process was found and killed, false otherwise
   */
  cancelJob(jobId: string): boolean {
    const child = this.activeProcesses.get(jobId);
    if (!child) {
      console.log(`[DockerExecutor] No active process found for job ${jobId}`);
      return false;
    }

    console.log(`[DockerExecutor] Cancelling job ${jobId}, sending SIGTERM`);
    child.kill('SIGTERM');

    // Force kill after grace period if still running
    setTimeout(() => {
      if (this.activeProcesses.has(jobId)) {
        console.log(`[DockerExecutor] Grace period expired for ${jobId}, sending SIGKILL`);
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

    // Build the command
    const args = this.buildDockerArgs(options);
    console.log(`[DockerExecutor] Running: docker compose ${args.join(' ')}`);

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let killed = false;
      let timeoutHandle: NodeJS.Timeout | undefined;
      let killHandle: NodeJS.Timeout | undefined;

      // Use explicit project name to ensure consistency when running from container
      const projectName = process.env.COMPOSE_PROJECT_NAME || 'project_nomad';

      // When running in container, use host.env which has the original host paths
      // (not the overridden container paths from the process environment)
      const cwd = options.projectDir ?? this.projectDir;
      const hostEnvFile = `${cwd}/host.env`;
      const useHostEnv = existsSync(hostEnvFile);

      const composeArgs = useHostEnv
        ? ['compose', '-p', projectName, '--env-file', hostEnvFile, ...args]
        : ['compose', '-p', projectName, ...args];

      // When using host.env, remove container-overridden env vars so env-file values are used
      const spawnEnv = { ...process.env, ...options.env };
      if (useHostEnv) {
        // These vars have container paths that would break volume mounts
        delete spawnEnv.FIRESTARR_DATASET_PATH;
      }

      const child: ChildProcess = spawn('docker', composeArgs, {
        cwd,
        env: spawnEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Track process for cancellation support
      if (options.jobId) {
        this.activeProcesses.set(options.jobId, child);
      }

      // Set up timeout
      timeoutHandle = setTimeout(() => {
        console.log(`[DockerExecutor] Timeout after ${timeout}ms, sending SIGTERM`);
        killed = true;
        child.kill('SIGTERM');

        // Force kill after grace period
        killHandle = setTimeout(() => {
          console.log(`[DockerExecutor] Grace period expired, sending SIGKILL`);
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

        console.log(`[DockerExecutor] Completed with exit code ${exitCode} in ${durationMs}ms`);

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

        console.error(`[DockerExecutor] Spawn error:`, err);

        resolve(
          Result.fail(
            EngineError.executionFailed(
              EngineType.FireSTARR,
              `Failed to spawn docker process: ${err.message}`
            )
          )
        );
      });
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      const result = await this.runCommand(['compose', 'version'], 5000);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  async isServiceAvailable(service: string): Promise<boolean> {
    try {
      // Check if the service exists in docker-compose.yaml
      // Include --profile modeling to see services with profiles (e.g., firestarr-app)
      const result = await this.runCommand(
        ['compose', '--profile', 'modeling', 'config', '--services'],
        10000
      );
      if (result.exitCode !== 0) return false;

      const services = result.stdout.split('\n').filter(Boolean);
      if (!services.includes(service)) return false;

      // Check if image is available (or can be pulled)
      const imageResult = await this.runCommand(
        ['compose', '--profile', 'modeling', 'images', service],
        10000
      );
      return imageResult.exitCode === 0;
    } catch {
      return false;
    }
  }

  /**
   * Builds docker-compose run arguments
   */
  private buildDockerArgs(options: ContainerRunOptions): string[] {
    const args: string[] = ['run', '--rm'];

    // Add volume mounts
    if (options.volumes) {
      for (const vol of options.volumes) {
        const mount = vol.readOnly
          ? `${vol.hostPath}:${vol.containerPath}:ro`
          : `${vol.hostPath}:${vol.containerPath}`;
        args.push('-v', mount);
      }
    }

    // Add environment variables
    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        args.push('-e', `${key}=${value}`);
      }
    }

    // Add working directory
    if (options.workingDir) {
      args.push('-w', options.workingDir);
    }

    // Add service name
    if (options.service) {
      args.push(options.service);
    } else if (options.image) {
      // If using raw image, we need to create a temporary service
      // For now, require service name for docker-compose
      throw new Error('DockerExecutor requires service name for docker-compose');
    } else {
      throw new Error('Either service or image must be specified');
    }

    // Add command
    args.push(...options.command);

    return args;
  }

  /**
   * Runs a simple docker command with timeout
   */
  private runCommand(
    args: string[],
    timeout: number
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let timeoutHandle: NodeJS.Timeout | undefined;

      const child = spawn('docker', args, {
        cwd: this.projectDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      timeoutHandle = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('Command timed out'));
      }, timeout);

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        resolve({ exitCode: code ?? -1, stdout, stderr });
      });

      child.on('error', (err) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        reject(err);
      });
    });
  }
}

/**
 * Singleton instance
 */
let instance: DockerExecutor | null = null;

export function getDockerExecutor(projectDir?: string): IContainerExecutor {
  if (!instance) {
    instance = new DockerExecutor(projectDir);
  }
  return instance;
}

export function resetDockerExecutor(): void {
  instance = null;
}
