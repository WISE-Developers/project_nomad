import {
  FireModel,
  FireModelId,
  ModelResult,
  ModelResultId,
  ModelStatus,
  EngineType,
} from '../../domain/entities/index.js';
import { Coordinates, TimeRange, BoundingBox } from '../../domain/value-objects/index.js';

/**
 * Filter criteria for querying fire models
 */
export interface ModelFilter {
  /** Filter by status */
  readonly status?: ModelStatus | ModelStatus[];
  /** Filter by engine type */
  readonly engineType?: EngineType;
  /** Filter by creation date range */
  readonly createdBetween?: TimeRange;
  /** Filter by user ID */
  readonly userId?: string;
  /** Filter by name (partial match) */
  readonly nameContains?: string;
}

/**
 * Spatial filter for model queries
 */
export interface SpatialModelFilter extends ModelFilter {
  /** Find models within distance of point */
  readonly nearLocation?: {
    coordinates: Coordinates;
    radiusKm: number;
  };
  /** Find models within bounding box */
  readonly withinBounds?: BoundingBox;
  /** Find models with overlapping results */
  readonly overlapsGeometry?: string; // GeoJSON string
}

/**
 * Options for model queries
 */
export interface ModelQueryOptions {
  /** Maximum results to return */
  readonly limit?: number;
  /** Offset for pagination */
  readonly offset?: number;
  /** Sort field */
  readonly sortBy?: 'createdAt' | 'updatedAt' | 'name' | 'status';
  /** Sort direction */
  readonly sortOrder?: 'asc' | 'desc';
  /** Include results in response */
  readonly includeResults?: boolean;
}

/**
 * Paginated result for model queries
 */
export interface ModelQueryResult {
  /** Models matching the query */
  readonly models: FireModel[];
  /** Total count of matching models */
  readonly totalCount: number;
  /** Whether there are more results */
  readonly hasMore: boolean;
}

/**
 * Interface for fire model persistence.
 *
 * Handles storage and retrieval of:
 * - Fire model configurations
 * - Model execution results
 * - Model metadata and status
 */
export interface IModelRepository {
  /**
   * Saves a fire model.
   *
   * @param model - Fire model to save
   * @returns Saved model (may have updated timestamps)
   */
  save(model: FireModel): Promise<FireModel>;

  /**
   * Gets a fire model by ID.
   *
   * @param id - Model ID
   * @returns Model if found, null otherwise
   */
  findById(id: FireModelId): Promise<FireModel | null>;

  /**
   * Gets a fire model by ID, throwing if not found.
   *
   * @param id - Model ID
   * @returns Model
   * @throws If model not found
   */
  getById(id: FireModelId): Promise<FireModel>;

  /**
   * Finds models matching filter criteria.
   *
   * @param filter - Filter criteria
   * @param options - Query options
   * @returns Paginated model results
   */
  find(filter: ModelFilter, options?: ModelQueryOptions): Promise<ModelQueryResult>;

  /**
   * Finds models using spatial criteria.
   *
   * @param filter - Spatial filter criteria
   * @param options - Query options
   * @returns Paginated model results
   */
  findSpatial(filter: SpatialModelFilter, options?: ModelQueryOptions): Promise<ModelQueryResult>;

  /**
   * Updates a model's status.
   *
   * @param id - Model ID
   * @param status - New status
   * @returns Updated model
   */
  updateStatus(id: FireModelId, status: ModelStatus): Promise<FireModel>;

  /**
   * Deletes a fire model and its results.
   *
   * @param id - Model ID
   * @returns Whether deletion was successful
   */
  delete(id: FireModelId): Promise<boolean>;

  /**
   * Saves a model result.
   *
   * @param result - Model result to save
   * @returns Saved result
   */
  saveResult(result: ModelResult): Promise<ModelResult>;

  /**
   * Gets results for a model.
   *
   * @param modelId - Parent model ID
   * @returns Model results
   */
  getResults(modelId: FireModelId): Promise<ModelResult[]>;

  /**
   * Gets a specific result by ID.
   *
   * @param id - Result ID
   * @returns Result if found, null otherwise
   */
  findResultById(id: ModelResultId): Promise<ModelResult | null>;

  /**
   * Deletes results for a model.
   *
   * @param modelId - Parent model ID
   * @returns Number of deleted results
   */
  deleteResults(modelId: FireModelId): Promise<number>;

  /**
   * Counts models matching filter criteria.
   *
   * @param filter - Filter criteria
   * @returns Count of matching models
   */
  count(filter?: ModelFilter): Promise<number>;

  /**
   * Checks if a model exists.
   *
   * @param id - Model ID
   * @returns Whether model exists
   */
  exists(id: FireModelId): Promise<boolean>;

  /**
   * Gets models that have been in a non-terminal state for too long.
   * Used for cleanup and retry logic.
   *
   * @param maxAgeMinutes - Maximum age in minutes
   * @returns Stale models
   */
  findStaleModels(maxAgeMinutes: number): Promise<FireModel[]>;

  /**
   * Gets the MCP configuration JSON for a model.
   */
  getConfigJson(id: FireModelId): Promise<Record<string, unknown> | null>;

  /**
   * Saves MCP configuration JSON for a model.
   */
  saveConfigJson(id: FireModelId, config: Record<string, unknown>): Promise<void>;
}
