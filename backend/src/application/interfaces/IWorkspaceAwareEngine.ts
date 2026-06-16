/**
 * IWorkspaceAwareEngine
 *
 * Capability interface (ISP) for engines that maintain an on-disk working
 * directory per model. Kept separate from {@link IFireModelingEngine} so that
 * callers needing only filesystem-workspace access depend on this narrow
 * capability rather than the concrete engine implementation.
 */

import type { FireModelId } from '../../domain/entities/index.js';

export interface IWorkspaceAwareEngine {
  /**
   * Returns the absolute path to the model's working directory, or null if it
   * cannot be determined.
   */
  getWorkingDirectory(modelId: FireModelId): string | null;
}
