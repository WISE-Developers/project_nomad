/**
 * Model Results Service
 *
 * Retrieves and manages model execution results.
 * Bridges the FireSTARR engine output parsing with the API layer.
 */

import { Result } from '../common/index.js';
import { DomainError, NotFoundError } from '../../domain/errors/index.js';
import {
  type FireModelId,
  type ModelResultId,
  ModelResult,
  OutputType,
  OutputFormat,
} from '../../domain/entities/index.js';
import { IFireModelingEngine, ExecutionStatus } from '../interfaces/IFireModelingEngine.js';

/**
 * Execution summary for API response
 */
export interface ExecutionSummary {
  startedAt: string | null;
  completedAt: string | null;
  durationSeconds: number | null;
  simulationCount?: number;
  status: ExecutionStatus['state'];
  progress: number;
  error?: string;
}

/**
 * Output item for API response
 */
export interface OutputItem {
  id: string;
  type: OutputType;
  format: OutputFormat;
  name: string;
  timeOffsetHours: number | null;
  filePath: string | null;
  previewUrl: string;
  downloadUrl: string;
  metadata: Record<string, unknown>;
}

/**
 * Full results response for API
 */
export interface ModelResultsResponse {
  modelId: string;
  modelName: string;
  engineType: string;
  executionSummary: ExecutionSummary;
  outputs: OutputItem[];
}

/**
 * In-memory result store
 * Maps resultId -> { modelId, result, filePath }
 */
interface StoredResult {
  modelId: FireModelId;
  result: ModelResult;
}

const resultStore: Map<string, StoredResult> = new Map();

/**
 * Service for managing model results
 */
export class ModelResultsService {
  constructor(private engine: IFireModelingEngine) {}

  /**
   * Get all results for a model
   */
  async getResults(
    modelId: FireModelId,
    modelName: string,
    engineType: string
  ): Promise<Result<ModelResultsResponse, DomainError>> {
    // Get execution status - handle engine not being configured
    let status: ExecutionStatus;
    try {
      status = await this.engine.getStatus(modelId);
    } catch (error) {
      // Engine not configured or model not found
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[ModelResultsService] Failed to get status for ${modelId}: ${message}`);

      // Return a "not started" status
      return Result.ok({
        modelId,
        modelName,
        engineType,
        executionSummary: {
          startedAt: null,
          completedAt: null,
          durationSeconds: null,
          status: 'queued',
          progress: 0,
          error: 'Engine not configured or model not initialized',
        },
        outputs: [],
      });
    }

    // Build execution summary with timestamps
    const startedAt = status.startedAt ? status.startedAt.toISOString() : null;
    const completedAt = status.completedAt ? status.completedAt.toISOString() : null;
    const durationSeconds = status.startedAt && status.completedAt
      ? (status.completedAt.getTime() - status.startedAt.getTime()) / 1000
      : null;

    const executionSummary: ExecutionSummary = {
      startedAt,
      completedAt,
      durationSeconds,
      status: status.state,
      progress: status.progress ?? 0,
      error: status.error,
    };

    // If not completed, return empty outputs
    if (status.state !== 'completed') {
      return Result.ok({
        modelId,
        modelName,
        engineType,
        executionSummary,
        outputs: [],
      });
    }

    // Get results from engine
    try {
      const results = await this.engine.getResults(modelId);

      // Store results and build output items
      const outputs: OutputItem[] = results.map((result) => {
        // Store result for later retrieval
        resultStore.set(result.id, { modelId, result });

        // Get file path from metadata
        const filePath = (result.metadata.filePath as string) ?? null;

        // Calculate time offset in hours from days
        const julianDay = (result.metadata.parameters as Record<string, unknown>)?.julianDay as number | undefined;
        const timeOffsetHours = julianDay !== undefined ? julianDay * 24 : null;

        return {
          id: result.id,
          type: result.outputType,
          format: result.format,
          name: result.getDisplayName(),
          timeOffsetHours,
          filePath,
          previewUrl: `/api/v1/results/${result.id}/preview`,
          downloadUrl: `/api/v1/results/${result.id}/download`,
          metadata: result.metadata as Record<string, unknown>,
        };
      });

      return Result.ok({
        modelId,
        modelName,
        engineType,
        executionSummary,
        outputs,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Result.fail(new NotFoundError('Results', modelId, message));
    }
  }

  /**
   * Get a specific result by ID
   */
  getResultById(resultId: ModelResultId): StoredResult | undefined {
    return resultStore.get(resultId);
  }

  /**
   * Get file path for a result
   */
  getResultFilePath(resultId: ModelResultId): string | null {
    const stored = resultStore.get(resultId);
    if (!stored) return null;
    return (stored.result.metadata.filePath as string) ?? null;
  }
}

// Singleton instance
let instance: ModelResultsService | null = null;

export function getModelResultsService(engine: IFireModelingEngine): ModelResultsService {
  if (!instance) {
    instance = new ModelResultsService(engine);
  }
  return instance;
}

export function resetModelResultsService(): void {
  instance = null;
}
