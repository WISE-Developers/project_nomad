/**
 * Executor Factory
 *
 * Returns the appropriate executor based on FIRESTARR_EXECUTION_MODE.
 * Supports 'docker' (default) and 'binary' modes.
 */

import { IContainerExecutor } from '../../application/interfaces/IContainerExecutor.js';
import { getDockerExecutor } from '../docker/index.js';
import { getNativeBinaryExecutor } from '../nativebinary/index.js';

/**
 * Execution mode for FireSTARR engine.
 */
export type ExecutionMode = 'docker' | 'binary';

/**
 * Gets the current execution mode from environment.
 *
 * @returns 'docker' or 'binary'
 */
export function getExecutionMode(): ExecutionMode {
  const mode = process.env.FIRESTARR_EXECUTION_MODE?.toLowerCase();

  if (mode === 'binary') {
    return 'binary';
  }

  return 'docker';
}

/**
 * Checks if we're running in binary execution mode.
 */
export function isBinaryMode(): boolean {
  return getExecutionMode() === 'binary';
}

/**
 * Gets the appropriate FireSTARR executor based on execution mode.
 *
 * - 'docker' (default): Uses DockerExecutor with docker-compose
 * - 'binary': Uses NativeBinaryExecutor for direct binary execution
 *
 * @returns The executor instance for the current mode
 */
export function getFireSTARRExecutor(): IContainerExecutor {
  const mode = getExecutionMode();

  if (mode === 'binary') {
    return getNativeBinaryExecutor();
  }

  return getDockerExecutor();
}
