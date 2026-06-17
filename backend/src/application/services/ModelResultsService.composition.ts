/**
 * Composition root for ModelResultsService.
 *
 * This is the ONLY place allowed to reference concrete infrastructure for the
 * results service. It wires the concrete repositories and artifact gateway into
 * the (infrastructure-free) ModelResultsService class. Kept separate from
 * ModelResultsService.ts so the service module itself has zero dependencies on
 * the infrastructure layer (Dependency Inversion Principle).
 */

import { ModelResultsService } from './ModelResultsService.js';
import type { IFireModelingEngine } from '../interfaces/IFireModelingEngine.js';
import { getResultRepository, getJobRepository } from '../../infrastructure/database/index.js';
import { getResultArtifactGateway } from '../../infrastructure/firestarr/ResultArtifactGateway.js';

// Singleton instance
let instance: ModelResultsService | null = null;

export function getModelResultsService(engine: IFireModelingEngine): ModelResultsService {
  if (!instance) {
    instance = new ModelResultsService(
      engine,
      getResultRepository(),
      getJobRepository(),
      getResultArtifactGateway()
    );
  }
  return instance;
}

export function resetModelResultsService(): void {
  instance = null;
}
