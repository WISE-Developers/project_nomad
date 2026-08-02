import { FireModel, FireModelId, ModelResult, EngineType } from '../../domain/entities/index.js';
import { SpatialGeometry } from '../../domain/entities/SpatialGeometry.js';
import { Coordinates, TimeRange } from '../../domain/value-objects/index.js';
import type { WeatherDataPoint, WeatherConfig } from './weather.js';

/**
 * Status of a model execution job
 */
export interface ExecutionStatus {
  /** Current state of execution */
  readonly state: 'queued' | 'initializing' | 'running' | 'processing' | 'completed' | 'failed';
  /** Progress percentage (0-100) if available */
  readonly progress?: number;
  /** Human-readable status message */
  readonly message?: string;
  /** Error details if failed */
  readonly error?: string;
  /** When execution started */
  readonly startedAt?: Date;
  /** When execution completed (success or failure) */
  readonly completedAt?: Date;
  /** Timestamp of last status update */
  readonly updatedAt: Date;
}

/**
 * Model mode - the type of fire modeling analysis to perform
 */
export type ModelMode = 'probabilistic' | 'deterministic' | 'long-term-risk';

/**
 * Output mode for model results
 */
export type OutputMode = 'probabilistic' | 'deterministic';

/**
 * Configuration options for model execution
 */
export interface ExecutionOptions {
  /** Ignition geometry (point, line, or polygon) */
  readonly ignitionGeometry: SpatialGeometry;
  /** Time range for the simulation */
  readonly timeRange: TimeRange;
  /** IANA timezone identifier for ignition location (e.g. "America/Edmonton"). Required — no silent default. */
  readonly timezone: string;
  /** Output time offsets in hours from start */
  readonly outputTimeOffsets?: number[];
  /** Probability threshold for perimeter generation (0-1) */
  readonly probabilityThreshold?: number;
  /** Whether to run in deterministic or probabilistic mode */
  readonly probabilistic?: boolean;
  /** Number of simulations for probabilistic runs */
  readonly simulationCount?: number;
  /** Weather data configuration */
  readonly weatherConfig?: WeatherConfig;
  /** Pre-resolved weather data (if weather has been fetched already) */
  readonly weatherData?: WeatherDataPoint[];
  /** Output mode: probabilistic (rasters) or deterministic (vector perimeters) */
  readonly outputMode?: OutputMode;
  /**
   * Confidence interval for perimeter generation (1-90, as percentage).
   * NOTE: As of issue #146 this value is hardcoded by the engine to 1 (captures all
   * pixels with any burn probability > 0%) and is ignored from caller input during
   * normal model execution. Custom values are still accepted by the POST /perimeters
   * endpoint for advanced use.
   */
  readonly confidenceInterval?: number;
  /**
   * Whether to smooth perimeter polygons.
   * NOTE: As of issue #146 this value is hardcoded by the engine to false and is
   * ignored from caller input during normal model execution. Custom values are still
   * accepted by the POST /perimeters endpoint for advanced use.
   */
  readonly smoothPerimeter?: boolean;
}

/**
 * Capabilities supported by a fire modeling engine
 */
export interface EngineCapabilities {
  /** Engine identifier */
  readonly engineType: EngineType;
  /** Human-readable engine name */
  readonly name: string;
  /** Engine version string */
  readonly version: string;
  /** Supports point ignitions */
  readonly supportsPointIgnition: boolean;
  /** Supports line ignitions */
  readonly supportsLineIgnition: boolean;
  /** Supports polygon ignitions */
  readonly supportsPolygonIgnition: boolean;
  /** Supports probabilistic modeling */
  readonly supportsProbabilistic: boolean;
  /** Maximum simulation duration in hours */
  readonly maxDurationHours: number;
  /** Available output types */
  readonly outputTypes: string[];
}

/**
 * Interface for fire modeling engine implementations.
 *
 * This abstraction allows swapping between different fire modeling engines
 * (FireSTARR, WISE, future engines) without changing application code.
 *
 * Implementations handle engine-specific details like:
 * - Input file generation
 * - Process execution
 * - Output parsing
 * - Status monitoring
 */
export interface IFireModelingEngine {
  /**
   * Gets the capabilities of this engine
   */
  getCapabilities(): EngineCapabilities;

  /**
   * Initializes the engine for a new model execution.
   * Creates necessary directories and validates inputs.
   *
   * @param model - The fire model to execute
   * @param options - Execution configuration
   * @returns Promise resolving when initialization is complete
   * @throws If inputs are invalid or initialization fails
   */
  initialize(model: FireModel, options: ExecutionOptions): Promise<void>;

  /**
   * Executes the fire model simulation.
   * This is an asynchronous operation that may take minutes to hours.
   *
   * @param modelId - ID of the previously initialized model
   * @returns Promise resolving when execution starts (not completes)
   * @throws If model was not initialized or execution fails to start
   */
  execute(modelId: FireModelId): Promise<void>;

  /**
   * Gets the current execution status of a model.
   *
   * @param modelId - ID of the model to check
   * @returns Current execution status
   */
  getStatus(modelId: FireModelId): Promise<ExecutionStatus>;

  /**
   * Gets the results of a completed model execution.
   *
   * @param modelId - ID of the completed model
   * @returns Array of model results (perimeters, probability maps, etc.)
   * @throws If model is not complete or results cannot be retrieved
   */
  getResults(modelId: FireModelId): Promise<ModelResult[]>;

  /**
   * Cancels a running model execution.
   *
   * @param modelId - ID of the model to cancel
   * @returns Promise resolving when cancellation is complete
   */
  cancel(modelId: FireModelId): Promise<void>;

  /**
   * Cleans up resources for a completed or cancelled model.
   *
   * @param modelId - ID of the model to clean up
   * @param keepResults - Whether to preserve result files
   */
  cleanup(modelId: FireModelId, keepResults?: boolean): Promise<void>;

  /**
   * Validates that a location can be modeled.
   * Checks for valid fuel type, DEM coverage, etc.
   *
   * Fuel grids are installed per vintage year, so coverage depends on WHICH
   * year is being modelled. modelYear is required on purpose: defaulting it to
   * the current year let validation check one vintage while the run used
   * another (refs #319).
   *
   * @param location - Coordinates to validate
   * @param modelYear - Year the model runs for; selects the fuel vintage
   * @returns Validation result with details
   */
  validateLocation(location: Coordinates, modelYear: number): Promise<{
    valid: boolean;
    reason?: string;
    fuelType?: string;
    utmZone?: number;
  }>;
}
