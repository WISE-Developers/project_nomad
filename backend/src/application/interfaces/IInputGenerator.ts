/**
 * Input Generator Interface
 *
 * Abstraction for generating input files for fire modeling engines.
 * Each engine (FireSTARR, WISE) has different input requirements.
 */

import { Result } from '../common/index.js';
import { DomainError } from '../../domain/errors/index.js';
import { type FireModelId } from '../../domain/entities/index.js';

/**
 * Result of input file generation
 */
export interface InputGenerationResult {
  /** Working directory for the simulation */
  readonly workingDir: string;
  /** Path to weather data file */
  readonly weatherFile: string;
  /** Path to perimeter file (if provided) */
  readonly perimeterFile?: string;
  /** Any additional generated config files */
  readonly configFiles: string[];
}

/**
 * Interface for input file generators.
 *
 * Implementations handle engine-specific input file formats,
 * including weather CSVs, perimeter rasters, and config files.
 *
 * @template TParams - Engine-specific parameter type
 */
export interface IInputGenerator<TParams> {
  /**
   * Generates all required input files for a model execution.
   *
   * @param modelId - Unique identifier for the model
   * @param params - Engine-specific parameters
   * @returns Result with generated file paths or error
   */
  generate(
    modelId: FireModelId,
    params: TParams
  ): Promise<Result<InputGenerationResult, DomainError>>;

  /**
   * Cleans up generated input files for a model.
   *
   * @param modelId - Model to clean up
   * @param keepResults - Whether to preserve result files
   */
  cleanup(modelId: FireModelId, keepResults?: boolean): Promise<void>;

  /**
   * Gets the working directory path for a model.
   *
   * @param modelId - Model identifier
   * @returns Absolute path to working directory
   */
  getWorkingDir(modelId: FireModelId): string;
}
