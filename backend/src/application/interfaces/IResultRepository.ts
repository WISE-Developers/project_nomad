import {
  ModelResult,
  ModelResultId,
  FireModelId,
} from '../../domain/entities/index.js';

/**
 * Interface for model result persistence.
 *
 * Handles storage and retrieval of model execution results.
 * Implementations may use SQLite (SAN mode) or PostgreSQL (ACN mode).
 */
export interface IResultRepository {
  /**
   * Saves a model result.
   *
   * @param result - Result to save
   * @returns Saved result
   */
  save(result: ModelResult): Promise<ModelResult>;

  /**
   * Updates an existing result.
   *
   * @param result - Result to update
   * @returns Updated result
   */
  update(result: ModelResult): Promise<ModelResult>;

  /**
   * Finds a result by ID.
   *
   * @param id - Result ID
   * @returns Result if found, null otherwise
   */
  findById(id: ModelResultId): Promise<ModelResult | null>;

  /**
   * Finds all results for a model.
   *
   * @param modelId - Parent model ID
   * @returns Results for the model
   */
  findByModelId(modelId: FireModelId): Promise<ModelResult[]>;

  /**
   * Gets all results.
   *
   * @returns All results
   */
  findAll(): Promise<ModelResult[]>;

  /**
   * Deletes a result by ID.
   *
   * @param id - Result ID
   * @returns Whether deletion succeeded
   */
  delete(id: ModelResultId): Promise<boolean>;

  /**
   * Deletes all results for a model.
   *
   * @param modelId - Parent model ID
   * @returns Number of deleted results
   */
  deleteByModelId(modelId: FireModelId): Promise<number>;

  /**
   * Checks if a result exists.
   *
   * @param id - Result ID
   * @returns Whether result exists
   */
  exists(id: ModelResultId): Promise<boolean>;
}
