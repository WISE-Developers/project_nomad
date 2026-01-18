/**
 * Native Binary Executor Singleton Factory
 *
 * Provides a singleton instance of NativeBinaryExecutor.
 */

import { IContainerExecutor } from '../../application/interfaces/IContainerExecutor.js';
import { NativeBinaryExecutor } from './NativeBinaryExecutor.js';

/**
 * Singleton instance
 */
let instance: NativeBinaryExecutor | null = null;

/**
 * Gets the singleton NativeBinaryExecutor instance.
 *
 * @param binaryPath - Optional path to the FireSTARR binary (defaults to FIRESTARR_BINARY_PATH env var)
 * @returns The singleton executor instance
 */
export function getNativeBinaryExecutor(binaryPath?: string): IContainerExecutor {
  if (!instance) {
    instance = new NativeBinaryExecutor(binaryPath);
  }
  return instance;
}

/**
 * Resets the singleton instance (for testing).
 */
export function resetNativeBinaryExecutor(): void {
  instance = null;
}
