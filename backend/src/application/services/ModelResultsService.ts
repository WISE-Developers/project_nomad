/**
 * Model Results Service
 *
 * Retrieves and manages model execution results.
 * Bridges the FireSTARR engine output parsing with the API layer.
 * Results are persisted to SQLite for survival across restarts.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Feature, FeatureCollection, Point, LineString, Polygon } from 'geojson';
import { Result } from '../common/index.js';
import { DomainError, NotFoundError } from '../../domain/errors/index.js';
import { parseIsoToDate } from '../../shared/dateParsing.js';
import {
  type FireModelId,
  type ModelResultId,
  ModelResult,
  OutputType,
  OutputFormat,
} from '../../domain/entities/index.js';
import { IFireModelingEngine, ExecutionStatus } from '../interfaces/IFireModelingEngine.js';
import type {
  IResultRepository,
  IJobRepository,
  IResultArtifactGateway,
} from '../interfaces/index.js';
import { createFireModelId } from '../../domain/entities/FireModel.js';

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
  type: 'point' | 'polygon' | 'linestring';
  coordinates: [number, number] | [number, number][] | [number, number][][];
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
 * Output configuration used for model run
 */
export interface OutputConfig {
  outputMode: 'probabilistic' | 'deterministic';
  confidenceInterval: number;
  smoothPerimeter: boolean;
}

/**
 * Full results response for API
 */
export interface ModelResultsResponse {
  modelId: string;
  modelName: string;
  engineType: string;
  userId: string | null;
  notes: string | null;
  executionSummary: ExecutionSummary;
  inputs?: ModelInputs;
  outputs: OutputItem[];
  outputConfig?: OutputConfig;
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
  constructor(
    private engine: IFireModelingEngine,
    private resultRepo: IResultRepository,
    private jobRepo: IJobRepository,
    private gateway: IResultArtifactGateway
  ) {}

  /**
   * Get all results for a model
   */
  async getResults(
    modelId: FireModelId,
    modelName: string,
    engineType: string,
    userId?: string,
    notes?: string | null
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
        // No job found — check if this is an imported/completed model with DB results
        const dbResults = await this.resultRepo.findByModelId(createFireModelId(modelId));
        if (dbResults.length > 0) {
          // Imported model with results but no job — treat as completed
          useDatabase = true;
          status = {
            state: 'completed',
            progress: 100,
            updatedAt: new Date(),
          };
          console.log(`[ModelResultsService] No job but ${dbResults.length} DB results — treating as completed import`);
        } else {
          return Result.ok({
            modelId,
            modelName,
            engineType,
            userId: userId ?? null,
            notes: notes ?? null,
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
        userId: userId ?? null,
        notes: notes ?? null,
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

        // If database is empty but model is completed, try to harvest from disk
        if (results.length === 0) {
          console.log(`[ModelResultsService] Database empty for completed model ${modelId}, attempting disk harvest`);
          try {
            // Try to get results from engine (which parses disk files)
            const diskResults = await this.engine.getResults(modelId);
            if (diskResults.length > 0) {
              // Save harvested results to database for future use
              for (const result of diskResults) {
                try {
                  await this.resultRepo.save(result);
                } catch (e) {
                  console.log(`[ModelResultsService] Result ${result.id} save error: ${e}`);
                }
              }
              results = diskResults;
              console.log(`[ModelResultsService] Harvested ${results.length} results from disk for ${modelId}`);
            }
          } catch (harvestError) {
            console.warn(`[ModelResultsService] Disk harvest failed for ${modelId}:`, harvestError);
            // Continue with empty results
          }
        }
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

        // Calculate time offset in hours from days.
        // TODO(#236-followup): this used to be `julianDay * 24` which is
        // year-anchored (e.g. Jun 19 → 4080h). The deterministic perimeter
        // path below uses `(julianDay - startJulian) * 24` instead. This .map
        // runs for stored DB results (probabilistic outputs) where startJulian
        // is not yet in scope; null is safer than a misleading absolute value.
        const timeOffsetHours: number | null = null;

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
      let loadedOutputConfig: OutputConfig | undefined;
      if (outputs.length > 0 && outputs[0].filePath) {
        // Resolve relative path to absolute path for file operations
        const absoluteFilePath = this.gateway.resolveResultFilePath(outputs[0].filePath);
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
            } else if (geomType === 'LineString') {
              const coords = (feature.geometry as LineString).coordinates as [number, number][];
              inputs.ignition = {
                type: 'linestring',
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

        // Check for output-config.json (local runs) or model.json (imports) for mode detection
        const configPath = path.join(simDir, 'output-config.json');
        const modelJsonPath = path.join(simDir, 'model.json');
        try {
          if (fs.existsSync(configPath)) {
            const configContent = fs.readFileSync(configPath, 'utf-8');
            loadedOutputConfig = JSON.parse(configContent) as OutputConfig;
          } else if (fs.existsSync(modelJsonPath)) {
            // Imported models have model.json instead of output-config.json
            const modelJsonContent = fs.readFileSync(modelJsonPath, 'utf-8');
            const modelJson = JSON.parse(modelJsonContent);
            loadedOutputConfig = {
              outputMode: modelJson.modelMode === 'deterministic' ? 'deterministic' : 'probabilistic',
              confidenceInterval: 1,
              smoothPerimeter: false,
            };
            console.log(`[ModelResultsService] Loaded mode from model.json: ${loadedOutputConfig.outputMode}`);
          }
          if (loadedOutputConfig) {

            if (loadedOutputConfig.outputMode === 'deterministic') {
              console.log(`[ModelResultsService] Deterministic mode — extracting perimeters from arrival-time grids for ${modelId}`);

              // Check if perimeter outputs already exist
              const hasPerimeters = outputs.some(o => o.type === 'perimeter');

              // Hoisted so the perimeter cherry-pick below can compute
              // hours-since-simStart from each perimeter's filename julianDay.
              // null when no arrival raster / timeRange is available.
              let startJulianForPerimeters: number | null = null;

              // Arrival raster output (#226) — emit one OutputItem pointing at
              // the classified tile endpoint. Classification window is derived
              // from the model's configured timeRange, not from file count.
              try {
                const arrival = this.gateway.findArrivalTifs(simDir);
                if (arrival) {
                  // Read timeRange from output-config.json to derive the model's
                  // actual duration (not the number of arrival files, which can
                  // include a trailing boundary file).
                  const rawConfig = JSON.parse(fs.readFileSync(
                    path.join(simDir, fs.existsSync(path.join(simDir, 'output-config.json'))
                      ? 'output-config.json' : 'model.json'),
                    'utf-8',
                  ));
                  const timeRange = rawConfig.timeRange as { start: string; end: string } | undefined;

                  let startDate: string;
                  let startJulian = arrival.offsetDay;
                  let endJulian = arrival.endJulian;

                  if (timeRange) {
                    const startDt = parseIsoToDate(timeRange.start, 'ModelResultsService timeRange.start');
                    const endDt = parseIsoToDate(timeRange.end, 'ModelResultsService timeRange.end');
                    startDate = startDt.toISOString();
                    const dayOfYear = (d: Date) => {
                      const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
                      return Math.floor((d.getTime() - jan1.getTime()) / 86_400_000) + 1;
                    };
                    startJulian = dayOfYear(startDt);
                    endJulian = dayOfYear(endDt);
                  } else {
                    // Fallback: derive year from weather.csv
                    let modelYear = new Date().getFullYear();
                    try {
                      const weatherPath = path.join(simDir, 'weather.csv');
                      if (fs.existsSync(weatherPath)) {
                        const firstLines = fs.readFileSync(weatherPath, 'utf-8').split('\n').slice(0, 2);
                        const dateMatch = firstLines[1]?.match(/(\d{4})-\d{2}-\d{2}/);
                        if (dateMatch) modelYear = parseInt(dateMatch[1], 10);
                      }
                    } catch { /* use current year */ }
                    startDate = new Date(Date.UTC(modelYear, 0, startJulian)).toISOString();
                  }
                  startJulianForPerimeters = startJulian;

                  outputs.push({
                    id: `arrival-time-${modelId}`,
                    type: 'arrival_time' as OutputType,
                    format: 'geotiff' as OutputFormat,
                    name: 'Fire Arrival Time',
                    timeOffsetHours: null,
                    filePath: null,
                    previewUrl: `/api/v1/models/${modelId}/arrival-tile/{z}/{x}/{y}.png`,
                    downloadUrl: `/api/v1/models/${modelId}/arrival-tile/{z}/{x}/{y}.png`,
                    metadata: {
                      isRaster: true,
                      tileUrlTemplate: `/api/v1/models/${modelId}/arrival-tile/{z}/{x}/{y}.png`,
                      boundsUrl: `/api/v1/models/${modelId}/arrival-bounds`,
                      offsetDay: startJulian,
                      startJulian,
                      endJulian,
                      startDate,
                      julianDays: arrival.julianDays,
                      deterministic: true,
                    },
                  });
                }
              } catch (e) {
                console.warn(`[ModelResultsService] Arrival raster metadata unavailable:`, e);
              }

              if (!hasPerimeters) {
                // Extract perimeters from arrival-time rasters
                const perimeterResult = await this.gateway.extractDeterministicPerimeters(simDir);

                // Perimeter colors — progression from orange→red→crimson (no yellow)
                // Colorblind-friendly perimeter colors — high contrast, distinct hues
                const PERIMETER_COLORS = ['#e65100', '#1565c0', '#2e7d32', '#6a1b9a', '#c62828', '#00838f'];

                if (perimeterResult.success && perimeterResult.value.perimeters.length > 0) {
                  perimeterResult.value.perimeters.forEach((perimeter, index) => {
                    const dateLabel = perimeter.date || `Day ${perimeter.julianDay}`;
                    const color = PERIMETER_COLORS[index % PERIMETER_COLORS.length];
                    // Hours since sim start, not "hours since Jan 1 of year 0".
                    // perimeter.julianDay is the FILENAME's 1-indexed day-of-year
                    // (170 = Jun 19), startJulian was computed from timeRange.start
                    // above. For a 3-day sim starting Jun 19 these read 0, 24, 48.
                    outputs.push({
                      id: `perimeter-day${perimeter.julianDay}-${modelId}`,
                      type: 'perimeter' as OutputType,
                      format: 'geojson' as OutputFormat,
                      name: `Fire Boundary - ${dateLabel}`,
                      timeOffsetHours: startJulianForPerimeters !== null
                        ? (perimeter.julianDay - startJulianForPerimeters) * 24
                        : null,
                      filePath: null,
                      previewUrl: `/api/v1/models/${modelId}/perimeters?day=${perimeter.julianDay}`,
                      downloadUrl: `/api/v1/models/${modelId}/perimeters?day=${perimeter.julianDay}&download=true`,
                      metadata: {
                        day: perimeter.julianDay,
                        date: perimeter.date,
                        deterministic: true,
                        color,
                        geojson: perimeter.geojson,
                      },
                    });
                  });
                  console.log(`[ModelResultsService] Added ${perimeterResult.value.perimeters.length} deterministic perimeter outputs`);
                } else if (!perimeterResult.success) {
                  console.warn(`[ModelResultsService] Failed to extract deterministic perimeters: ${perimeterResult.error.message}`);
                }
              }
            }
          }
        } catch (e) {
          console.warn(`[ModelResultsService] Error checking output-config.json:`, e);
        }
      }

      // In deterministic mode, surface perimeters and the arrival-time raster;
      // probability rasters are hidden because they aren't produced in this mode.
      const filteredOutputs = loadedOutputConfig?.outputMode === 'deterministic'
        ? outputs.filter(o => o.type === 'perimeter' || o.type === 'arrival_time')
        : outputs;

      return Result.ok({
        modelId,
        modelName,
        engineType,
        userId: userId ?? null,
        notes: notes ?? null,
        executionSummary,
        inputs,
        outputs: filteredOutputs,
        outputConfig: loadedOutputConfig,
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
   * Regenerate the GeoJSON for a synthetic deterministic-perimeter output (#292).
   *
   * Deterministic perimeters are surfaced by getResults() with the id
   * `perimeter-day{julianDay}-{modelId}` but are never persisted as result rows
   * (their bytes are extracted on demand from the arrival-time rasters). The
   * download route therefore can't find them via the repository; this method
   * re-extracts the perimeter the same way getResults() does and returns its
   * GeoJSON so it can be downloaded. Returns undefined for any id that is not a
   * resolvable synthetic perimeter.
   */
  async getPerimeterGeoJSON(resultId: ModelResultId): Promise<string | undefined> {
    const match = /^perimeter-day(\d+)-(.+)$/.exec(resultId);
    if (!match) return undefined;
    const julianDay = Number(match[1]);
    const modelId = createFireModelId(match[2]);

    // Resolve the model's sim directory from any of its stored result files
    // (same resolution getResults() uses to locate the arrival-time rasters).
    const dbResults = await this.resultRepo.findByModelId(modelId);
    const anchor = dbResults.find(r => (r.metadata.filePath as string | undefined));
    if (!anchor) return undefined;
    const simDir = path.dirname(
      this.gateway.resolveResultFilePath(anchor.metadata.filePath as string)
    );

    const extraction = await this.gateway.extractDeterministicPerimeters(simDir);
    if (!extraction.success) return undefined;
    const perimeter = extraction.value.perimeters.find(p => p.julianDay === julianDay);
    if (!perimeter) return undefined;

    return JSON.stringify(perimeter.geojson);
  }

  /**
   * Resolve the downloadable arrival-time GeoTIFF for a synthetic arrival output (#292).
   *
   * The arrival-time raster is surfaced by getResults() with the id
   * `arrival-time-{modelId}` (format geotiff) but is never persisted as a result
   * row — it is served live as classified tiles. The download route therefore
   * can't find it via the repository; this returns the absolute path of the
   * cumulative arrival GeoTIFF on disk so it can be streamed. Returns undefined
   * for any id that is not a resolvable synthetic arrival raster.
   */
  async getArrivalRasterPath(resultId: ModelResultId): Promise<string | undefined> {
    const match = /^arrival-time-(.+)$/.exec(resultId);
    if (!match) return undefined;
    const modelId = createFireModelId(match[1]);

    const dbResults = await this.resultRepo.findByModelId(modelId);
    const anchor = dbResults.find(r => (r.metadata.filePath as string | undefined));
    if (!anchor) return undefined;
    const simDir = path.dirname(
      this.gateway.resolveResultFilePath(anchor.metadata.filePath as string)
    );

    const arrival = this.gateway.findArrivalTifs(simDir);
    if (!arrival) return undefined;
    return arrival.filePath;
  }

  /**
   * Get file path for a result (resolved to absolute path)
   */
  async getResultFilePath(resultId: ModelResultId): Promise<string | null> {
    const result = await this.resultRepo.findById(resultId);
    if (!result) return null;
    const relativePath = (result.metadata.filePath as string) ?? null;
    if (!relativePath) return null;
    return this.gateway.resolveResultFilePath(relativePath);
  }
}

// Composition root (factory + reset) lives in ModelResultsService.composition.ts
// so this module has zero dependencies on the infrastructure layer. Re-exported
// here to preserve the existing import path/signature for all callers.
export {
  getModelResultsService,
  resetModelResultsService,
} from './ModelResultsService.composition.js';
