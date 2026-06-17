/**
 * Result Artifact Gateway (infrastructure implementation)
 *
 * Concrete implementation of the application `IResultArtifactGateway` port.
 * Delegates to the existing FireSTARR infrastructure functions. This is the
 * adapter that lets ModelResultsService depend on an application abstraction
 * while the real filesystem/raster work stays in the infrastructure layer.
 */

import type {
  IResultArtifactGateway,
  ArrivalArtifactInfo,
  DeterministicPerimeterExtraction,
} from '../../application/interfaces/index.js';
import type { Result } from '../../application/common/index.js';
import type { ValidationError, NotFoundError } from '../../domain/errors/index.js';
import { resolveResultFilePath } from './FireSTARRInputGenerator.js';
import { findArrivalTifs, extractDeterministicPerimeters } from './index.js';

export class ResultArtifactGateway implements IResultArtifactGateway {
  resolveResultFilePath(relativePath: string): string {
    return resolveResultFilePath(relativePath);
  }

  findArrivalTifs(simDir: string): ArrivalArtifactInfo | null {
    return findArrivalTifs(simDir);
  }

  extractDeterministicPerimeters(
    simDir: string,
  ): Promise<Result<DeterministicPerimeterExtraction, ValidationError | NotFoundError>> {
    return extractDeterministicPerimeters(simDir);
  }
}

let instance: ResultArtifactGateway | null = null;

export function getResultArtifactGateway(): ResultArtifactGateway {
  if (!instance) {
    instance = new ResultArtifactGateway();
  }
  return instance;
}
