/**
 * Model Results Service
 *
 * Retrieves and manages model execution results.
 * Bridges the FireSTARR engine output parsing with the API layer.
 * Results are persisted to SQLite for survival across restarts.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Feature, FeatureCollection, Point, Polygon } from 'geojson';
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
import { getResultRepository, getJobRepository } from '../../infrastructure/database/index.js';
import type { IResultRepository, IJobRepository } from '../interfaces/index.js';
import { createFireModelId } from '../../domain/entities/FireModel.js';
import { resolveResultFilePath } from '../../infrastructure/firestarr/FireSTARRInputGenerator.js';

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
 * Ignition geometry for display on map
 */
export interface IgnitionGeometry {
  type: 'point' | 'polygon';
  coordinates: [number, number] | [number, number][][];
  geojson: Feature | FeatureCollection;
}

/**
 * Model inputs for download/display
 */
export interface ModelInputs {
  /** Ignition geometry */
  ignition?: IgnitionGeometry;
  /** Weather CSV file path (for download) */
  weatherCsvPath?: string;
  /** Weather CSV download URL */
  weatherDownloadUrl?: string;
}

/**
 * Full results response for API
 */
export interface ModelResultsResponse {
  modelId: string;
  modelName: string;
  engineType: string;
  executionSummary: ExecutionSummary;
  inputs?: ModelInputs;
  outputs: OutputItem[];
}

/**
 * Stored result interface for API compatibility
 */
interface StoredResult {
  modelId: FireModelId;
  result: ModelResult;
}

/**
 * Service for managing model results
 */
export class ModelResultsService {
  constructor(private engine: IFireModelingEngine) {}

  private get resultRepo(): IResultRepository {
    return getResultRepository();
  }

  private get jobRepo(): IJobRepository {
    return getJobRepository();
  }

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
    let useDatabase = false;

    try {
      status = await this.engine.getStatus(modelId);
    } catch (error) {
      // Engine not configured or model not found in current session
      // Fall back to database for jobs that completed before restart
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[ModelResultsService] Engine doesn't have ${modelId}, checking database: ${message}`);

      // Check job repository for status
      const jobs = await this.jobRepo.findByModelId(createFireModelId(modelId));
      const latestJob = jobs[0]; // Jobs are sorted by createdAt DESC

      if (latestJob) {
        useDatabase = true;
        console.log(`[ModelResultsService] Job from database:`, {
          id: latestJob.id,
          status: latestJob.status,
          startedAt: latestJob.startedAt?.toISOString() ?? 'NULL',
          completedAt: latestJob.completedAt?.toISOString() ?? 'NULL',
          createdAt: latestJob.createdAt.toISOString(),
        });
        status = {
          state: latestJob.status as ExecutionStatus['state'],
          progress: latestJob.progress,
          startedAt: latestJob.startedAt,
          completedAt: latestJob.completedAt,
          updatedAt: latestJob.completedAt ?? latestJob.startedAt ?? latestJob.createdAt,
          error: latestJob.error,
        };
        console.log(`[ModelResultsService] Found job in database: ${latestJob.status}`);
      } else {
        // No job found in database either
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
            error: 'Model has not been executed',
          },
          outputs: [],
        });
      }
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

    // Get results - from engine or database
    try {
      let results: ModelResult[];

      if (useDatabase) {
        // Get results from database (for models that ran before restart)
        results = await this.resultRepo.findByModelId(createFireModelId(modelId));
        console.log(`[ModelResultsService] Found ${results.length} results in database for ${modelId}`);
      } else {
        // Get results from engine (for models running in current session)
        results = await this.engine.getResults(modelId);

        // Check if results already exist in database (avoid duplicates)
        const existingResults = await this.resultRepo.findByModelId(createFireModelId(modelId));
        if (existingResults.length === 0) {
          // Only save if no results exist yet
          for (const result of results) {
            try {
              await this.resultRepo.save(result);
            } catch (e) {
              console.log(`[ModelResultsService] Result ${result.id} save error: ${e}`);
            }
          }
          console.log(`[ModelResultsService] Saved ${results.length} results for ${modelId}`);
        } else {
          // Use existing results from database instead
          results = existingResults;
          console.log(`[ModelResultsService] Using ${results.length} existing results for ${modelId}`);
        }
      }

      // Build output items
      const outputs: OutputItem[] = results.map((result) => {
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

      // Build model inputs (ignition + weather)
      let inputs: ModelInputs | undefined;
      if (outputs.length > 0 && outputs[0].filePath) {
        // Resolve relative path to absolute path for file operations
        const absoluteFilePath = resolveResultFilePath(outputs[0].filePath);
        const simDir = path.dirname(absoluteFilePath);
        inputs = {};

        // Try to load ignition geometry
        const ignitionPath = path.join(simDir, 'ignition.geojson');
        try {
          if (fs.existsSync(ignitionPath)) {
            const geojsonContent = fs.readFileSync(ignitionPath, 'utf-8');
            const geojson = JSON.parse(geojsonContent) as Feature | FeatureCollection;

            // Extract geometry type and coordinates
            const feature = 'features' in geojson ? geojson.features[0] : geojson;
            const geomType = feature?.geometry?.type;

            if (geomType === 'Point') {
              const coords = (feature.geometry as Point).coordinates as [number, number];
              inputs.ignition = {
                type: 'point',
                coordinates: coords,
                geojson,
              };
            } else if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
              const coords = (feature.geometry as Polygon).coordinates as [number, number][][];
              inputs.ignition = {
                type: 'polygon',
                coordinates: coords,
                geojson,
              };
            }
            console.log(`[ModelResultsService] Loaded ignition geometry from ${ignitionPath}`);
          }
        } catch (e) {
          console.warn(`[ModelResultsService] Failed to load ignition.geojson:`, e);
        }

        // Check for weather.csv
        const weatherPath = path.join(simDir, 'weather.csv');
        if (fs.existsSync(weatherPath)) {
          inputs.weatherCsvPath = weatherPath;
          inputs.weatherDownloadUrl = `/api/v1/models/${modelId}/inputs/weather`;
        }

        // Only include inputs if we found something
        if (!inputs.ignition && !inputs.weatherCsvPath) {
          inputs = undefined;
        }
      }

      return Result.ok({
        modelId,
        modelName,
        engineType,
        executionSummary,
        inputs,
        outputs,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Result.fail(new NotFoundError('Results', modelId, message));
    }
  }

  /**
   * Get a specific result by ID (from database)
   */
  async getResultById(resultId: ModelResultId): Promise<StoredResult | undefined> {
    const result = await this.resultRepo.findById(resultId);
    if (!result) return undefined;

    return {
      modelId: result.fireModelId,
      result,
    };
  }

  /**
   * Get file path for a result (resolved to absolute path)
   */
  async getResultFilePath(resultId: ModelResultId): Promise<string | null> {
    const result = await this.resultRepo.findById(resultId);
    if (!result) return null;
    const relativePath = (result.metadata.filePath as string) ?? null;
    if (!relativePath) return null;
    return resolveResultFilePath(relativePath);
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
