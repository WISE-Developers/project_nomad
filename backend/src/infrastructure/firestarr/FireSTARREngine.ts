/**
 * FireSTARR Engine Implementation
 *
 * Implements IFireModelingEngine for FireSTARR fire modeling.
 * Orchestrates Docker execution, input generation, and output parsing.
 */

import { join } from 'path';
import { existsSync } from 'fs';
import {
  IFireModelingEngine,
  ExecutionStatus,
  ExecutionOptions,
  EngineCapabilities,
} from '../../application/interfaces/IFireModelingEngine.js';
import { IContainerExecutor, OutputCallback } from '../../application/interfaces/IContainerExecutor.js';
import { IInputGenerator, InputGenerationResult } from '../../application/interfaces/IInputGenerator.js';
import { IOutputParser, ParsedOutput } from '../../application/interfaces/IOutputParser.js';
import {
  FireModel,
  type FireModelId,
  ModelResult,
  createModelResultId,
  EngineType,
  GeometryType,
} from '../../domain/entities/index.js';
import { Coordinates } from '../../domain/value-objects/index.js';
import { FireSTARRParams, WeatherHourlyData } from './types.js';
import { getFireSTARRExecutor, isBinaryMode } from '../execution/index.js';
import { FireSTARRInputGenerator, createFireSTARRInputGenerator } from './FireSTARRInputGenerator.js';
import { FireSTARROutputParser, getFireSTARROutputParser } from './FireSTARROutputParser.js';
import { getWeatherService } from '../weather/index.js';
import type { WeatherDataPoint } from '../weather/types.js';
import { logger } from '../logging/index.js';

/** FireSTARR Docker service name */
const FIRESTARR_SERVICE = 'firestarr-app';

/** Path to FireSTARR binary inside container */
const FIRESTARR_BINARY = '/appl/firestarr/firestarr';

/**
 * Output configuration for post-processing
 */
interface OutputConfig {
  outputMode: 'probabilistic' | 'pseudo-deterministic';
  confidenceInterval: number;
  smoothPerimeter: boolean;
}

/**
 * Execution state tracked per model
 */
interface ExecutionState {
  status: ExecutionStatus;
  inputResult?: InputGenerationResult;
  params?: FireSTARRParams;
  startTime?: Date;
  completedTime?: Date;
  outputConfig?: OutputConfig;
}

/**
 * FireSTARR fire modeling engine.
 *
 * Provides complete integration with FireSTARR including:
 * - Docker-based execution
 * - Input file generation (weather CSV, perimeter TIF)
 * - Output parsing (probability TIFs)
 * - Status tracking and progress reporting
 */
export class FireSTARREngine implements IFireModelingEngine {
  private readonly executor: IContainerExecutor;
  private readonly inputGenerator: IInputGenerator<FireSTARRParams>;
  private readonly outputParser: IOutputParser<ParsedOutput[]>;
  private readonly executions: Map<string, ExecutionState> = new Map();

  constructor(
    executor?: IContainerExecutor,
    inputGenerator?: IInputGenerator<FireSTARRParams>,
    outputParser?: IOutputParser<ParsedOutput[]>
  ) {
    this.executor = executor ?? getFireSTARRExecutor();
    this.inputGenerator = inputGenerator ?? createFireSTARRInputGenerator();
    this.outputParser = outputParser ?? getFireSTARROutputParser();
  }

  getCapabilities(): EngineCapabilities {
    return {
      engineType: EngineType.FireSTARR,
      name: 'FireSTARR',
      version: '0.1.0',
      supportsPointIgnition: true,
      supportsLineIgnition: false,
      supportsPolygonIgnition: true,
      supportsProbabilistic: true,
      maxDurationHours: 336, // 14 days
      outputTypes: ['probability', 'perimeter'],
    };
  }

  async initialize(model: FireModel, options: ExecutionOptions): Promise<void> {
    logger.engine(`Initializing model`, 'FireSTARR', model.id);

    // Convert ExecutionOptions to FireSTARRParams
    const params = await this.buildParams(model, options);

    // Generate input files
    const inputResult = await this.inputGenerator.generate(model.id, params);
    if (!inputResult.success) {
      throw new Error(`Input generation failed: ${inputResult.error.message}`);
    }

    // Build output configuration for post-processing
    const outputConfig: OutputConfig = {
      outputMode: options.outputMode ?? 'probabilistic',
      confidenceInterval: options.confidenceInterval ?? 50,
      smoothPerimeter: options.smoothPerimeter ?? false,
    };

    // Save output config to working directory for persistence
    const configPath = join(inputResult.value.workingDir, 'output-config.json');
    const { writeFile } = await import('fs/promises');
    await writeFile(configPath, JSON.stringify(outputConfig, null, 2));
    logger.engine(`Saved output config to ${configPath}`, 'FireSTARR', model.id);

    // Store execution state
    this.executions.set(model.id, {
      status: {
        state: 'queued',
        message: 'Model initialized, ready to execute',
        updatedAt: new Date(),
      },
      inputResult: inputResult.value,
      params,
      outputConfig,
    });

    logger.engine(`Model initialized successfully`, 'FireSTARR', model.id);
  }

  async execute(modelId: FireModelId): Promise<void> {
    const state = this.executions.get(modelId);
    if (!state || !state.inputResult || !state.params) {
      throw new Error(`Model ${modelId} not initialized`);
    }

    logger.engine(`Starting execution`, 'FireSTARR', modelId);

    // Update status
    const startTime = new Date();
    state.startTime = startTime;
    state.status = {
      state: 'initializing',
      message: 'Starting Docker container',
      startedAt: startTime,
      updatedAt: startTime,
    };

    // Build command
    const command = this.buildCommand(state.params, state.inputResult);
    logger.engine(`Command: ${command.join(' ')}`, 'FireSTARR', modelId);

    // Create output callback for progress tracking
    const onOutput: OutputCallback = (line, stream) => {
      // Update progress based on output
      const progressMatch = line.match(/Running scenario (\d+) of (\d+)/);
      if (progressMatch) {
        const current = parseInt(progressMatch[1], 10);
        const total = parseInt(progressMatch[2], 10);
        const progress = Math.round((current / total) * 100);

        state.status = {
          state: 'running',
          progress,
          message: `Running scenario ${current} of ${total}`,
          startedAt: state.startTime,
          updatedAt: new Date(),
        };
      }

      // Log output
      if (stream === 'stderr') {
        logger.error(line, 'FireSTARR:output');
      } else {
        logger.info(line, 'FireSTARR:output');
      }
    };

    // Build environment variables for native binary execution
    const env: Record<string, string> = {};
    if (process.env.PROJ_DATA) {
      env.PROJ_DATA = process.env.PROJ_DATA;
    }

    // Execute via executor (pass modelId for cancellation support)
    const result = await this.executor.runStream(
      {
        service: FIRESTARR_SERVICE,
        command,
        timeout: 4 * 60 * 60 * 1000, // 4 hours
        jobId: modelId, // Enable cancellation tracking
        env: Object.keys(env).length > 0 ? env : undefined,
      },
      onOutput
    );

    // Update status based on result
    if (!result.success) {
      const failedAt = new Date();
      state.completedTime = failedAt;
      state.status = {
        state: 'failed',
        error: result.error.message,
        message: 'Docker execution failed',
        startedAt: state.startTime,
        completedAt: failedAt,
        updatedAt: failedAt,
      };
      logger.error(`Execution failed: ${result.error.message}`, 'FireSTARR', { modelId });
      return;
    }

    const containerResult = result.value;

    if (containerResult.exitCode !== 0) {
      const failedAt = new Date();
      state.completedTime = failedAt;
      state.status = {
        state: 'failed',
        error: `Process exited with code ${containerResult.exitCode}`,
        message: 'FireSTARR execution failed',
        startedAt: state.startTime,
        completedAt: failedAt,
        updatedAt: failedAt,
      };
      logger.error(`Exit code ${containerResult.exitCode}`, 'FireSTARR', { modelId });
      return;
    }

    // Parse log for final status
    const logPath = join(state.inputResult.workingDir, 'firestarr.log');
    const summary = await (this.outputParser as FireSTARROutputParser).parseLog(logPath);

    const completedTime = new Date();
    state.completedTime = completedTime;

    if (summary.success) {
      state.status = {
        state: 'completed',
        progress: 100,
        message: `Completed in ${summary.durationSeconds?.toFixed(1)}s`,
        startedAt: state.startTime,
        completedAt: completedTime,
        updatedAt: completedTime,
      };
      logger.engine(`Execution completed successfully`, 'FireSTARR', modelId);
    } else {
      state.status = {
        state: 'failed',
        error: summary.errors.join('; '),
        message: 'Execution did not complete successfully',
        startedAt: state.startTime,
        completedAt: completedTime,
        updatedAt: completedTime,
      };
      logger.error(`Execution failed: ${summary.errors.join('; ')}`, 'FireSTARR', { modelId });
    }
  }

  async getStatus(modelId: FireModelId): Promise<ExecutionStatus> {
    const state = this.executions.get(modelId);
    if (!state) {
      // Throw error so callers can fall back to database
      throw new Error(`Model ${modelId} not found in engine (may have run in previous session)`);
    }
    return state.status;
  }

  /**
   * Gets the working directory for a model.
   * Falls back to the standard path if not in current session.
   */
  getWorkingDirectory(modelId: FireModelId): string | null {
    const state = this.executions.get(modelId);
    if (state?.inputResult?.workingDir) {
      return state.inputResult.workingDir;
    }
    // Fall back to standard path structure using same resolution as InputGenerator
    const datasetPath = process.env.FIRESTARR_DATASET_PATH;
    if (!datasetPath) {
      logger.warn('FIRESTARR_DATASET_PATH not set', 'FireSTARR');
      return null;
    }
    // Resolve paths from project root (parent of backend dir) to match InputGenerator
    const projectRoot = join(process.cwd(), '..');
    const resolvedDatasetPath = datasetPath.startsWith('/') ? datasetPath : join(projectRoot, datasetPath);
    const standardPath = join(resolvedDatasetPath, 'sims', modelId);
    if (existsSync(standardPath)) {
      return standardPath;
    }
    return null;
  }

  async getResults(modelId: FireModelId): Promise<ModelResult[]> {
    // Try to get working directory from state, fall back to filesystem
    let workingDir: string | null = null;
    const state = this.executions.get(modelId);
    if (state?.inputResult?.workingDir) {
      workingDir = state.inputResult.workingDir;
    } else {
      // Fall back to getWorkingDirectory which checks the filesystem
      workingDir = this.getWorkingDirectory(modelId);
      if (workingDir) {
        logger.engine(`Using fallback working directory: ${workingDir}`, 'FireSTARR', modelId);
      }
    }

    if (!workingDir) {
      throw new Error(`Model ${modelId} not found - no state and no working directory on disk`);
    }

    // Parse outputs
    const parseResult = await this.outputParser.parse(workingDir);
    if (!parseResult.success) {
      throw new Error(`Failed to parse outputs: ${parseResult.error.message}`);
    }

    // Convert to ModelResult entities
    const results: ModelResult[] = parseResult.value.map((output) =>
      new ModelResult({
        id: createModelResultId(crypto.randomUUID()),
        fireModelId: modelId,
        outputType: output.type,
        format: output.format,
        metadata: {
          ...output.metadata,
          filePath: output.filePath,
        },
        createdAt: output.metadata.generatedAt instanceof Date
          ? output.metadata.generatedAt
          : new Date(),
      })
    );

    logger.engine(`Retrieved ${results.length} results`, 'FireSTARR', modelId);
    return results;
  }

  async cancel(modelId: FireModelId): Promise<void> {
    const state = this.executions.get(modelId);
    if (!state) {
      return;
    }

    // Kill the running process if active
    const executorWithCancel = this.executor as { cancelJob?: (jobId: string) => boolean };
    if (executorWithCancel.cancelJob) {
      const killed = executorWithCancel.cancelJob(modelId);
      logger.engine(`Cancel request: ${killed ? 'process killed' : 'no active process'}`, 'FireSTARR', modelId);
    }

    // Update status
    const cancelledAt = new Date();
    state.completedTime = cancelledAt;
    state.status = {
      state: 'failed',
      error: 'Cancelled by user',
      message: 'Execution cancelled',
      startedAt: state.startTime,
      completedAt: cancelledAt,
      updatedAt: cancelledAt,
    };

    logger.engine(`Cancelled model`, 'FireSTARR', modelId);
  }

  async cleanup(modelId: FireModelId, keepResults = false): Promise<void> {
    const state = this.executions.get(modelId);
    if (state) {
      await this.inputGenerator.cleanup(modelId, keepResults);
      this.executions.delete(modelId);
    }
    logger.engine(`Cleaned up model`, 'FireSTARR', modelId);
  }

  async validateLocation(location: Coordinates): Promise<{
    valid: boolean;
    reason?: string;
    fuelType?: string;
    utmZone?: number;
  }> {
    // Calculate UTM zone from longitude
    const utmZone = Math.floor((location.longitude + 180) / 6) + 1;

    // For now, just check if coordinates are reasonable for Canada
    const lat = location.latitude;
    const lon = location.longitude;

    if (lat < 41 || lat > 84) {
      return {
        valid: false,
        reason: 'Latitude outside Canadian coverage (41°N - 84°N)',
        utmZone,
      };
    }

    if (lon < -141 || lon > -52) {
      return {
        valid: false,
        reason: 'Longitude outside Canadian coverage (141°W - 52°W)',
        utmZone,
      };
    }

    // Check actual fuel grid coverage
    try {
      const inputGen = this.inputGenerator as FireSTARRInputGenerator;
      const currentYear = new Date().getFullYear();
      const fuelGridPath = await inputGen.findFuelGridForCoordinates(lat, lon, currentYear);

      if (!fuelGridPath) {
        return {
          valid: false,
          reason: 'No fuel grid coverage at this location',
          utmZone,
        };
      }

      // Sample the pixel value at this location
      const fuelCode = await this.sampleFuelGridPixel(fuelGridPath, lat, lon);

      if (fuelCode === null || fuelCode === 0) {
        return {
          valid: false,
          reason: 'No data at this location in fuel grid',
          utmZone,
        };
      }

      if (fuelCode === 99 || fuelCode === 100 || fuelCode === 102) {
        // 99 = Non-fuel, 100 = Water, 102 = Unknown
        return {
          valid: false,
          reason: 'Non-burnable fuel type at this location',
          utmZone,
        };
      }

      return {
        valid: true,
        fuelType: this.getFuelTypeName(fuelCode),
        utmZone,
      };
    } catch (error) {
      // If fuel grid check fails, fall back to basic validation
      logger.warn(`Fuel grid validation failed, allowing location: ${error}`, 'FireSTARR');
      return {
        valid: true,
        utmZone,
      };
    }
  }

  /**
   * Sample a pixel value from a fuel grid at given WGS84 coordinates.
   */
  private async sampleFuelGridPixel(
    fuelGridPath: string,
    latitude: number,
    longitude: number
  ): Promise<number | null> {
    try {
      const gdalModule = await import('gdal-async');
      const gdal = gdalModule.default;

      const ds = await gdal.openAsync(fuelGridPath);
      const band = ds.bands.get(1);
      const gt = ds.geoTransform;
      const srs = ds.srs;

      if (!gt || !srs || !band) {
        ds.close();
        return null;
      }

      // Transform WGS84 coordinates to raster CRS
      const wgs84 = gdal.SpatialReference.fromProj4('+proj=longlat +datum=WGS84 +no_defs');
      const transform = new gdal.CoordinateTransformation(wgs84, srs);
      const transformed = transform.transformPoint(longitude, latitude);

      // Convert to pixel coordinates
      const pixelX = Math.floor((transformed.x - gt[0]) / gt[1]);
      const pixelY = Math.floor((transformed.y - gt[3]) / gt[5]);

      // Check bounds
      if (pixelX < 0 || pixelX >= ds.rasterSize.x || pixelY < 0 || pixelY >= ds.rasterSize.y) {
        ds.close();
        return null;
      }

      // Read single pixel
      const data = band.pixels.read(pixelX, pixelY, 1, 1);
      ds.close();

      return data[0] ?? null;
    } catch (error) {
      logger.error(`Failed to sample fuel grid: ${error}`, 'FireSTARR');
      return null;
    }
  }

  /**
   * Get human-readable fuel type name from code.
   */
  private getFuelTypeName(code: number): string {
    const fuelTypes: Record<number, string> = {
      1: 'C-1 Spruce-Lichen Woodland',
      2: 'C-2 Boreal Spruce',
      3: 'C-3 Mature Jack/Lodgepole Pine',
      4: 'C-4 Immature Jack/Lodgepole Pine',
      5: 'C-5 Red/White Pine',
      6: 'C-6 Conifer Plantation',
      7: 'C-7 Ponderosa Pine/Douglas Fir',
      11: 'D-1 Leafless Aspen',
      12: 'D-2 Green Aspen',
      21: 'M-1 Boreal Mixedwood (Leafless)',
      22: 'M-2 Boreal Mixedwood (Green)',
      23: 'M-3 Dead Balsam Fir (Leafless)',
      24: 'M-4 Dead Balsam Fir (Green)',
      31: 'S-1 Jack/Lodgepole Pine Slash',
      32: 'S-2 White Spruce/Balsam Slash',
      33: 'S-3 Coastal Cedar/Hemlock/Fir Slash',
      40: 'O-1a Matted Grass',
      41: 'O-1b Standing Grass',
    };
    return fuelTypes[code] || `Fuel Type ${code}`;
  }

  /**
   * Builds FireSTARR parameters from model and execution options.
   */
  private async buildParams(_model: FireModel, options: ExecutionOptions): Promise<FireSTARRParams> {
    // Extract coordinates from ignition geometry
    const ignition = options.ignitionGeometry;
    let latitude: number;
    let longitude: number;

    // Get centroid for line/polygon, or point coordinates
    if (ignition.type === GeometryType.Point) {
      const coords = ignition.coordinates as [number, number];
      longitude = coords[0];
      latitude = coords[1];
    } else {
      // Use centroid for other geometry types
      const centroid = ignition.getCentroid();
      longitude = centroid[0];
      latitude = centroid[1];
    }

    // Resolve weather data
    let weatherPoints: WeatherDataPoint[];

    if (options.weatherData && options.weatherData.length > 0) {
      // Use pre-resolved weather data
      weatherPoints = options.weatherData;
    } else if (options.weatherConfig) {
      // Resolve weather from config
      const weatherService = getWeatherService();
      weatherPoints = await weatherService.resolveWeather(
        options.weatherConfig,
        { latitude, longitude },
        { start: options.timeRange.start, end: options.timeRange.end }
      );
    } else {
      throw new Error('Weather data or weatherConfig required for model execution');
    }

    // Convert WeatherDataPoint[] to WeatherHourlyData[]
    const weatherData: WeatherHourlyData[] = weatherPoints.map((wp) => ({
      date: wp.datetime,
      temp: wp.temperature,
      rh: wp.humidity,
      ws: wp.windSpeed,
      wd: wp.windDirection,
      precip: wp.precipitation,
      ffmc: wp.ffmc,
      dmc: wp.dmc,
      dc: wp.dc,
      isi: wp.isi ?? 0,
      bui: wp.bui ?? 0,
      fwi: wp.fwi ?? 0,
    }));

    // Extract previous day indices from first weather point
    const firstPoint = weatherPoints[0];

    // Calculate output date offsets based on simulation duration
    const durationMs = options.timeRange.end.getTime() - options.timeRange.start.getTime();
    const durationDays = Math.ceil(durationMs / (24 * 60 * 60 * 1000));
    const outputDateOffsets = this.calculateOutputOffsets(durationDays);

    return {
      latitude,
      longitude,
      startDate: options.timeRange.start,
      startTime: this.formatTime(options.timeRange.start),
      weatherData,
      previousFFMC: firstPoint.ffmc,
      previousDMC: firstPoint.dmc,
      previousDC: firstPoint.dc,
      previousPrecip: firstPoint.precipitation,
      outputDateOffsets,
      perimeter: ignition.type === GeometryType.Polygon ? ignition : undefined,
      ignitionGeometry: ignition, // Save original ignition geometry for export
    };
  }

  /**
   * Calculate output date offsets based on simulation duration.
   *
   * FBANs expect an output raster for every day of the simulation.
   * Returns [1, 2, 3, ..., durationDays]
   */
  private calculateOutputOffsets(durationDays: number): number[] {
    if (durationDays <= 0) {
      return [1]; // Minimum 1 day output
    }
    // Output every day from 1 to durationDays
    return Array.from({ length: durationDays }, (_, i) => i + 1);
  }

  /**
   * Builds the FireSTARR CLI command.
   * Uses container paths for Docker mode, host paths for binary mode.
   */
  private buildCommand(params: FireSTARRParams, inputResult: InputGenerationResult): string[] {
    // Determine paths based on execution mode
    let workingDir: string;
    let weatherFile: string;
    let binaryPath: string;

    if (isBinaryMode()) {
      // Binary mode: use host paths directly
      workingDir = inputResult.workingDir;
      weatherFile = `${workingDir}/weather.csv`;
      binaryPath = process.env.FIRESTARR_BINARY_PATH ?? FIRESTARR_BINARY;
    } else {
      // Docker mode: use container paths (Docker mounts dataset at /appl/data)
      workingDir = (this.inputGenerator as FireSTARRInputGenerator)
        .getContainerWorkingDir(inputResult.workingDir.split('/').pop()! as FireModelId);
      weatherFile = `${workingDir}/weather.csv`;
      binaryPath = FIRESTARR_BINARY;
    }

    // Use corrected centroid from perimeter rasterization if available
    // This ensures the ignition point matches the perimeter raster center
    const latitude = inputResult.perimeterCentroid?.latitude ?? params.latitude;
    const longitude = inputResult.perimeterCentroid?.longitude ?? params.longitude;

    if (inputResult.perimeterCentroid) {
      logger.debug(`Using corrected centroid: lat=${latitude.toFixed(6)}, lon=${longitude.toFixed(6)} (original: lat=${params.latitude.toFixed(6)}, lon=${params.longitude.toFixed(6)})`, 'FireSTARR');
    }

    // Calculate UTC offset from longitude (natural solar timezone)
    // Each 15° of longitude = 1 hour offset from UTC
    const utcOffset = Math.round(longitude / 15);

    const args: string[] = [
      binaryPath,
      workingDir,
      this.formatDate(params.startDate),
      latitude.toString(),
      longitude.toString(),
      params.startTime,
      '--tz', utcOffset.toString(),
      '--wx', weatherFile,
      '--ffmc', params.previousFFMC.toString(),
      '--dmc', params.previousDMC.toString(),
      '--dc', params.previousDC.toString(),
    ];

    // Optional parameters
    if (params.previousPrecip !== undefined) {
      args.push('--apcp_prev', params.previousPrecip.toString());
    }

    if (inputResult.perimeterFile) {
      if (isBinaryMode()) {
        // Binary mode: use host path directly
        args.push('--perim', inputResult.perimeterFile);
      } else {
        // Docker mode: extract filename and build container path
        const perimeterFilename = inputResult.perimeterFile.split('/').pop();
        const containerPerimeterFile = `${workingDir}/${perimeterFilename}`;
        args.push('--perim', containerPerimeterFile);
      }
    }

    if (params.outputDateOffsets) {
      args.push('--output_date_offsets', JSON.stringify(params.outputDateOffsets));
    }

    // Add verbosity
    args.push('-v');

    return args;
  }

  /**
   * Formats a date as yyyy-mm-dd.
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Formats a date's time as HH:MM.
   */
  private formatTime(date: Date): string {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }
}

/**
 * Singleton instance
 */
let instance: FireSTARREngine | null = null;

export function getFireSTARREngine(): IFireModelingEngine {
  if (!instance) {
    instance = new FireSTARREngine();
  }
  return instance;
}

export function resetFireSTARREngine(): void {
  instance = null;
}
