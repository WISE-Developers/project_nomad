/**
 * FireSTARR Engine Implementation
 *
 * Implements IFireModelingEngine for FireSTARR fire modeling.
 * Orchestrates Docker execution, input generation, and output parsing.
 */

import { join } from 'path';
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
import { FireSTARRParams } from './types.js';
import { getDockerExecutor } from '../docker/index.js';
import { FireSTARRInputGenerator, createFireSTARRInputGenerator } from './FireSTARRInputGenerator.js';
import { FireSTARROutputParser, getFireSTARROutputParser } from './FireSTARROutputParser.js';

/** FireSTARR Docker service name */
const FIRESTARR_SERVICE = 'firestarr-app';

/** Path to FireSTARR binary inside container */
const FIRESTARR_BINARY = '/appl/firestarr/firestarr';

/**
 * Execution state tracked per model
 */
interface ExecutionState {
  status: ExecutionStatus;
  inputResult?: InputGenerationResult;
  params?: FireSTARRParams;
  startTime?: Date;
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
  private readonly dockerExecutor: IContainerExecutor;
  private readonly inputGenerator: IInputGenerator<FireSTARRParams>;
  private readonly outputParser: IOutputParser<ParsedOutput[]>;
  private readonly executions: Map<string, ExecutionState> = new Map();

  constructor(
    dockerExecutor?: IContainerExecutor,
    inputGenerator?: IInputGenerator<FireSTARRParams>,
    outputParser?: IOutputParser<ParsedOutput[]>
  ) {
    this.dockerExecutor = dockerExecutor ?? getDockerExecutor();
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
    console.log(`[FireSTARREngine] Initializing model ${model.id}`);

    // Convert ExecutionOptions to FireSTARRParams
    const params = this.buildParams(model, options);

    // Generate input files
    const inputResult = await this.inputGenerator.generate(model.id, params);
    if (!inputResult.success) {
      throw new Error(`Input generation failed: ${inputResult.error.message}`);
    }

    // Store execution state
    this.executions.set(model.id, {
      status: {
        state: 'queued',
        message: 'Model initialized, ready to execute',
        updatedAt: new Date(),
      },
      inputResult: inputResult.value,
      params,
    });

    console.log(`[FireSTARREngine] Model ${model.id} initialized successfully`);
  }

  async execute(modelId: FireModelId): Promise<void> {
    const state = this.executions.get(modelId);
    if (!state || !state.inputResult || !state.params) {
      throw new Error(`Model ${modelId} not initialized`);
    }

    console.log(`[FireSTARREngine] Starting execution for model ${modelId}`);

    // Update status
    state.status = {
      state: 'initializing',
      message: 'Starting Docker container',
      updatedAt: new Date(),
    };
    state.startTime = new Date();

    // Build command
    const command = this.buildCommand(state.params, state.inputResult);
    console.log(`[FireSTARREngine] Command: ${command.join(' ')}`);

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
          updatedAt: new Date(),
        };
      }

      // Log output
      if (stream === 'stderr') {
        console.error(`[FireSTARR] ${line}`);
      } else {
        console.log(`[FireSTARR] ${line}`);
      }
    };

    // Execute via Docker
    const result = await this.dockerExecutor.runStream(
      {
        service: FIRESTARR_SERVICE,
        command,
        timeout: 4 * 60 * 60 * 1000, // 4 hours
      },
      onOutput
    );

    // Update status based on result
    if (!result.success) {
      state.status = {
        state: 'failed',
        error: result.error.message,
        message: 'Docker execution failed',
        updatedAt: new Date(),
      };
      console.error(`[FireSTARREngine] Execution failed:`, result.error.message);
      return;
    }

    const containerResult = result.value;

    if (containerResult.exitCode !== 0) {
      state.status = {
        state: 'failed',
        error: `Process exited with code ${containerResult.exitCode}`,
        message: 'FireSTARR execution failed',
        updatedAt: new Date(),
      };
      console.error(`[FireSTARREngine] Exit code ${containerResult.exitCode}`);
      return;
    }

    // Parse log for final status
    const logPath = join(state.inputResult.workingDir, 'firestarr.log');
    const summary = await (this.outputParser as FireSTARROutputParser).parseLog(logPath);

    if (summary.success) {
      state.status = {
        state: 'completed',
        progress: 100,
        message: `Completed in ${summary.durationSeconds?.toFixed(1)}s`,
        updatedAt: new Date(),
      };
      console.log(`[FireSTARREngine] Execution completed successfully`);
    } else {
      state.status = {
        state: 'failed',
        error: summary.errors.join('; '),
        message: 'Execution did not complete successfully',
        updatedAt: new Date(),
      };
      console.error(`[FireSTARREngine] Execution failed:`, summary.errors);
    }
  }

  async getStatus(modelId: FireModelId): Promise<ExecutionStatus> {
    const state = this.executions.get(modelId);
    if (!state) {
      return {
        state: 'failed',
        error: 'Model not found',
        updatedAt: new Date(),
      };
    }
    return state.status;
  }

  async getResults(modelId: FireModelId): Promise<ModelResult[]> {
    const state = this.executions.get(modelId);
    if (!state || !state.inputResult) {
      throw new Error(`Model ${modelId} not found or not initialized`);
    }

    // Parse outputs
    const parseResult = await this.outputParser.parse(state.inputResult.workingDir);
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

    console.log(`[FireSTARREngine] Retrieved ${results.length} results for model ${modelId}`);
    return results;
  }

  async cancel(modelId: FireModelId): Promise<void> {
    const state = this.executions.get(modelId);
    if (!state) {
      return;
    }

    // TODO: Implement Docker container kill
    // For now, just update status
    state.status = {
      state: 'failed',
      error: 'Cancelled by user',
      message: 'Execution cancelled',
      updatedAt: new Date(),
    };

    console.log(`[FireSTARREngine] Cancelled model ${modelId}`);
  }

  async cleanup(modelId: FireModelId, keepResults = false): Promise<void> {
    const state = this.executions.get(modelId);
    if (state) {
      await this.inputGenerator.cleanup(modelId, keepResults);
      this.executions.delete(modelId);
    }
    console.log(`[FireSTARREngine] Cleaned up model ${modelId}`);
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

    // TODO: Check against actual fuel grid coverage
    // This would require reading the fuel grid and checking the cell value

    return {
      valid: true,
      utmZone,
    };
  }

  /**
   * Builds FireSTARR parameters from model and execution options.
   */
  private buildParams(_model: FireModel, options: ExecutionOptions): FireSTARRParams {
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

    // TODO: Get actual weather data
    // For now, create placeholder params - real implementation would
    // fetch weather from API or use provided data

    return {
      latitude,
      longitude,
      startDate: options.timeRange.start,
      startTime: this.formatTime(options.timeRange.start),
      weatherData: [], // TODO: Fetch weather data
      previousFFMC: 85, // TODO: Get from weather service
      previousDMC: 30,
      previousDC: 200,
      outputDateOffsets: options.outputTimeOffsets?.map((h) => Math.ceil(h / 24)) ?? [1, 2, 3, 7, 14],
      perimeter: ignition.type === GeometryType.Polygon ? ignition : undefined,
    };
  }

  /**
   * Builds the FireSTARR CLI command.
   */
  private buildCommand(params: FireSTARRParams, inputResult: InputGenerationResult): string[] {
    // Use container paths (Docker mounts dataset at /appl/data)
    const containerWorkingDir = (this.inputGenerator as FireSTARRInputGenerator)
      .getContainerWorkingDir(inputResult.workingDir.split('/').pop()! as FireModelId);
    const containerWeatherFile = `${containerWorkingDir}/weather.csv`;

    const args: string[] = [
      FIRESTARR_BINARY,
      containerWorkingDir,
      this.formatDate(params.startDate),
      params.latitude.toString(),
      params.longitude.toString(),
      params.startTime,
      '--wx', containerWeatherFile,
      '--ffmc', params.previousFFMC.toString(),
      '--dmc', params.previousDMC.toString(),
      '--dc', params.previousDC.toString(),
    ];

    // Optional parameters
    if (params.previousPrecip !== undefined) {
      args.push('--apcp_prev', params.previousPrecip.toString());
    }

    if (inputResult.perimeterFile) {
      const containerPerimeterFile = `${containerWorkingDir}/perimeter.tif`;
      args.push('--perim', containerPerimeterFile);
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
