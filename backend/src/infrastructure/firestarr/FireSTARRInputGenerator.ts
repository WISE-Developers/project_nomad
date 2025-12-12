/**
 * FireSTARR Input Generator
 *
 * Generates all required input files for FireSTARR execution:
 * - Weather CSV with FWI indices
 * - Perimeter TIF (if polygon provided)
 * - Working directory structure
 */

import { mkdir, rm, access, writeFile, readdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import type { Feature, Geometry } from 'geojson';
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
  /** Root path for fuel grids (e.g., /path/to/data/generated/grid/100m) */
  readonly gridRoot?: string;
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

  /**
   * Finds the fuel grid that contains the given coordinates.
   * Uses year-based lookup with fallback:
   *   1. First checks {gridRoot}/{modelYear}/ for year-specific fuel grids
   *   2. Falls back to {gridRoot}/default/
   *
   * @param latitude - WGS84 latitude
   * @param longitude - WGS84 longitude
   * @param modelYear - Model year for year-specific fuel lookup
   * @returns Path to matching fuel grid, or undefined if not found
   */
  async findFuelGridForCoordinates(
    latitude: number,
    longitude: number,
    modelYear: number
  ): Promise<string | undefined> {
    if (!this.config.gridRoot || !existsSync(this.config.gridRoot)) {
      console.warn('[FireSTARRInputGenerator] No gridRoot configured or path does not exist');
      return undefined;
    }

    // Try year-specific directory first, then fall back to default
    const dirsToCheck = [
      join(this.config.gridRoot, String(modelYear)),
      join(this.config.gridRoot, 'default'),
    ];

    try {
      // Dynamic import of gdal-async
      const gdalModule = await import('gdal-async');
      const gdal = gdalModule.default;

      for (const gridDir of dirsToCheck) {
        if (!existsSync(gridDir)) {
          continue;
        }

        // Scan for fuel_*.tif files in this directory
        const entries = await readdir(gridDir, { withFileTypes: true });
        const fuelFiles = entries.filter(
          e => e.isFile() && e.name.startsWith('fuel_') && e.name.endsWith('.tif')
        );

        // Sort fuel grids by proximity to query longitude
        // File naming: fuel_{zone}_{half}.tif where central meridian = zone * 6 - 183 + (half === 5 ? 3 : 0)
        // e.g., fuel_10_0 = -123°, fuel_10_5 = -120°, fuel_11_0 = -117°
        fuelFiles.sort((a, b) => {
          const getCentralMeridian = (name: string): number => {
            const match = name.match(/fuel_(\d+)_(\d+)/);
            if (!match) return 999;
            const zone = parseInt(match[1], 10);
            const half = parseInt(match[2], 10);
            return zone * 6 - 183 + (half === 5 ? 3 : 0);
          };
          const cmA = getCentralMeridian(a.name);
          const cmB = getCentralMeridian(b.name);
          return Math.abs(longitude - cmA) - Math.abs(longitude - cmB);
        });

        for (const fuelFile of fuelFiles) {
          const tifPath = join(gridDir, fuelFile.name);

          // Open raster and check extent
          const ds = await gdal.openAsync(tifPath);
          const gt = ds.geoTransform;
          const srs = ds.srs;

          if (!gt || !srs) {
            ds.close();
            continue;
          }

          // Get raster extent in native CRS
          const width = ds.rasterSize.x;
          const height = ds.rasterSize.y;
          const minX = gt[0];
          const maxY = gt[3];
          const maxX = minX + width * gt[1];
          const minY = maxY + height * gt[5]; // gt[5] is negative

          // Transform point from WGS84 to raster CRS
          // Note: fromEPSG(4326) doesn't work correctly with transformPoint, use proj4 string
          const wgs84 = gdal.SpatialReference.fromProj4('+proj=longlat +datum=WGS84 +no_defs');
          const transform = new gdal.CoordinateTransformation(wgs84, srs);

          // Log what we're transforming
          console.log(`[FireSTARRInputGenerator] Checking ${fuelFile.name}: lon=${longitude}, lat=${latitude}`);

          // Transform coordinates directly (lon, lat -> x, y in target CRS)
          let px: number, py: number;
          try {
            const transformed = transform.transformPoint(longitude, latitude);
            px = transformed.x;
            py = transformed.y;
            console.log(`[FireSTARRInputGenerator] Transformed to: x=${px}, y=${py}`);
          } catch (transformErr) {
            console.error(`[FireSTARRInputGenerator] Transform failed for ${fuelFile.name}:`, transformErr);
            ds.close();
            continue;
          }

          ds.close();

          // Check if point is within extent
          if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
            console.log(`[FireSTARRInputGenerator] Found fuel grid for (${latitude}, ${longitude}) year ${modelYear}: ${tifPath}`);
            return tifPath;
          }
        }
      }

      console.warn(`[FireSTARRInputGenerator] No fuel grid found containing coordinates (${latitude}, ${longitude})`);
      return undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[FireSTARRInputGenerator] Error finding fuel grid: ${message}`);
      return undefined;
    }
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

      // Write ignition geometry as GeoJSON Feature
      if (params.ignitionGeometry) {
        const ignitionFile = join(workingDir, 'ignition.geojson');
        const geometry = params.ignitionGeometry.toGeoJSON();
        const feature: Feature = {
          type: 'Feature',
          properties: {
            name: 'Ignition',
            geometryType: params.ignitionGeometry.type,
          },
          geometry: geometry as Geometry,
        };
        await writeFile(ignitionFile, JSON.stringify(feature, null, 2), 'utf-8');
        console.log(`[FireSTARRInputGenerator] Saved ignition geometry to ${ignitionFile}`);
      }

      // Handle perimeter if provided - rasterize to TIFF for FireSTARR
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
        } else {
          // Find fuel grid that contains the ignition coordinates
          const modelYear = params.startDate.getFullYear();
          const fuelGridPath = await this.findFuelGridForCoordinates(params.latitude, params.longitude, modelYear);
          if (!fuelGridPath) {
            console.warn('[FireSTARRInputGenerator] No fuel grid found for coordinates, skipping perimeter rasterization');
          } else {
            perimeterFile = join(workingDir, 'perimeter.tif');
            const rasterResult = await rasterizePerimeter({
              geometry: params.perimeter,
              templatePath: fuelGridPath,
              outputPath: perimeterFile,
            });

            if (!rasterResult.success) {
              console.warn(`[FireSTARRInputGenerator] Perimeter rasterization failed: ${rasterResult.error.message}`);
              perimeterFile = undefined;
            } else {
              console.log(`[FireSTARRInputGenerator] Rasterization succeeded, perimeterFile = ${perimeterFile}`);
            }
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

  return new FireSTARRInputGenerator({
    simsBasePath: join(resolvedPath, 'sims'),
    gridRoot: join(resolvedPath, 'generated/grid/100m'),
  });
}
