/**
 * FireSTARR Input Generator
 *
 * Generates all required input files for FireSTARR execution:
 * - Weather CSV with FWI indices
 * - Perimeter TIF (if polygon provided)
 * - Working directory structure
 */

import { mkdir, rm, access } from 'fs/promises';
import { join } from 'path';
import { IInputGenerator, InputGenerationResult } from '../../application/interfaces/IInputGenerator.js';
import { Result } from '../../application/common/index.js';
import { DomainError, ValidationError } from '../../domain/errors/index.js';
import { type FireModelId, GeometryType } from '../../domain/entities/index.js';
import { FireSTARRParams } from './types.js';
import { writeWeatherCSV, validateWeatherData } from './WeatherCSVWriter.js';
import { rasterizePerimeter, isGDALAvailable } from './PerimeterRasterizer.js';

/**
 * Configuration for FireSTARR input generation.
 */
export interface FireSTARRInputConfig {
  /** Base path for simulations (e.g., /path/to/data/sims) */
  readonly simsBasePath: string;
  /** Path to fuel grid template (for perimeter rasterization) */
  readonly fuelGridTemplatePath?: string;
}

/**
 * FireSTARR input file generator.
 *
 * Creates working directories and generates:
 * - weather.csv in required format
 * - perimeter.tif from polygon (if provided)
 */
export class FireSTARRInputGenerator implements IInputGenerator<FireSTARRParams> {
  private readonly config: FireSTARRInputConfig;

  constructor(config: FireSTARRInputConfig) {
    this.config = config;
  }

  async generate(
    modelId: FireModelId,
    params: FireSTARRParams
  ): Promise<Result<InputGenerationResult, DomainError>> {
    const workingDir = this.getWorkingDir(modelId);

    try {
      // Create working directory
      await mkdir(workingDir, { recursive: true });
      console.log(`[FireSTARRInputGenerator] Created working directory: ${workingDir}`);

      // Validate weather data
      const validation = validateWeatherData(params.weatherData);
      if (!validation.valid) {
        return Result.fail(
          new ValidationError(`Weather data validation failed: ${validation.issues.join('; ')}`)
        );
      }

      // Write weather CSV
      const weatherFile = join(workingDir, 'weather.csv');
      await writeWeatherCSV(weatherFile, params.weatherData, {
        scenarioId: params.scenarioId ?? 0,
      });

      // Handle perimeter if provided
      let perimeterFile: string | undefined;
      if (params.perimeter) {
        if (params.perimeter.type !== GeometryType.Polygon) {
          return Result.fail(
            new ValidationError(`Perimeter must be a polygon, got ${params.perimeter.type}`)
          );
        }

        // Check GDAL availability
        const gdalAvailable = await isGDALAvailable();
        if (!gdalAvailable) {
          console.warn('[FireSTARRInputGenerator] GDAL not available, skipping perimeter rasterization');
          console.warn('[FireSTARRInputGenerator] Install gdal-async for polygon perimeter support');
        } else if (!this.config.fuelGridTemplatePath) {
          console.warn('[FireSTARRInputGenerator] No fuel grid template configured for perimeter rasterization');
        } else {
          perimeterFile = join(workingDir, 'perimeter.tif');
          const rasterResult = await rasterizePerimeter({
            geometry: params.perimeter,
            templatePath: this.config.fuelGridTemplatePath,
            outputPath: perimeterFile,
          });

          if (!rasterResult.success) {
            console.warn(`[FireSTARRInputGenerator] Perimeter rasterization failed: ${rasterResult.error.message}`);
            perimeterFile = undefined;
          }
        }
      }

      const result: InputGenerationResult = {
        workingDir,
        weatherFile,
        perimeterFile,
        configFiles: [],
      };

      console.log(`[FireSTARRInputGenerator] Generated inputs for model ${modelId}:`, result);

      return Result.ok(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[FireSTARRInputGenerator] Failed to generate inputs:`, error);
      return Result.fail(new ValidationError(`Input generation failed: ${message}`));
    }
  }

  async cleanup(modelId: FireModelId, keepResults = false): Promise<void> {
    const workingDir = this.getWorkingDir(modelId);

    try {
      // Check if directory exists
      await access(workingDir);

      if (keepResults) {
        // Only remove input files, keep outputs
        const inputFiles = ['weather.csv', 'perimeter.tif'];
        for (const file of inputFiles) {
          try {
            await rm(join(workingDir, file), { force: true });
          } catch {
            // Ignore if file doesn't exist
          }
        }
        console.log(`[FireSTARRInputGenerator] Cleaned input files for ${modelId}, preserved outputs`);
      } else {
        // Remove entire directory
        await rm(workingDir, { recursive: true, force: true });
        console.log(`[FireSTARRInputGenerator] Removed working directory for ${modelId}`);
      }
    } catch {
      // Directory doesn't exist, nothing to clean
      console.log(`[FireSTARRInputGenerator] Nothing to clean for ${modelId}`);
    }
  }

  getWorkingDir(modelId: FireModelId): string {
    // Sanitize modelId for filesystem
    const sanitizedId = modelId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.config.simsBasePath, sanitizedId);
  }

  /**
   * Gets the container-side working directory path.
   * Maps from host path to container path.
   */
  getContainerWorkingDir(modelId: FireModelId): string {
    // Container mounts dataset at /appl/data
    // Host: {FIRESTARR_DATASET_PATH}/sims/{modelId}
    // Container: /appl/data/sims/{modelId}
    const sanitizedId = modelId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `/appl/data/sims/${sanitizedId}`;
  }
}

/**
 * Creates a FireSTARR input generator from environment configuration.
 */
export function createFireSTARRInputGenerator(): FireSTARRInputGenerator {
  // Use FIRESTARR_DATASET_PATH from environment (must match docker-compose.yaml volume mount)
  const datasetPath = process.env.FIRESTARR_DATASET_PATH;
  if (!datasetPath) {
    throw new Error('FIRESTARR_DATASET_PATH environment variable not set. Check your .env file.');
  }

  // Resolve relative paths from project root (parent of backend dir)
  // This matches where docker-compose.yaml resolves paths from
  const projectRoot = join(process.cwd(), '..');
  const resolvedPath = datasetPath.startsWith('/')
    ? datasetPath
    : join(projectRoot, datasetPath);

  // Look for fuel grid in expected locations
  // The fuel grid path depends on UTM zone, so we'll configure this dynamically
  // For now, just set up the base config

  return new FireSTARRInputGenerator({
    simsBasePath: join(resolvedPath, 'sims'),
    // Fuel grid template will be determined per-model based on coordinates
  });
}
