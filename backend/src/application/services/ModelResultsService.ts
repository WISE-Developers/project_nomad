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
import {
  type FireModelId,
  type ModelResultId,
  ModelResult,
  OutputType,
  OutputFormat,
} from '../../domain/entities/index.js';
import { TimeRange } from '../../domain/value-objects/index.js';
import { IFireModelingEngine, ExecutionStatus } from '../interfaces/IFireModelingEngine.js';
import type {
  IResultRepository,
  IJobRepository,
  IResultArtifactGateway,
} from '../interfaces/index.js';
import { createFireModelId } from '../../domain/entities/FireModel.js';
import { readModelStartDate, readModelTimeRange } from './modelStartDate.js';
import {
  timeOffsetHoursForJulianDay,
  dayOfYear,
  resolveSeriesStartJulian,
} from './julianTimeOffset.js';
import { readFuelVintage, type FuelVintageRecord } from './fuelVintageRecord.js';
import { readDerivedModelDate, type DerivedModelDate } from './derivedModelDate.js';

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
  /**
   * Date the model was simulated FOR, ISO-8601 (#319).
   * Not the execution time — fuel vintage is selected by the modelled year, so
   * reporting execution time would attribute a 2023 fire to 2026 fuel.
   * Absent when nothing on disk records it.
   */
  modelStartDate?: string;
  /**
   * The fuel vintage this run actually used, recorded when it ran (#331).
   * Absent for runs that predate the recording — displayed as "not recorded"
   * rather than re-resolved, because installing a year later must not rewrite
   * what a past run claims.
   */
  fuelVintage?: FuelVintageRecord;
  /**
   * The DAY recovered from the engine's own `sizes_<julian>_<date>.csv` names,
   * for runs that recorded no time range anywhere (#482 half 2).
   *
   * A SEPARATE FIELD FROM modelStartDate ON PURPOSE. That one is an ISO-8601
   * instant; this is a calendar date with no time of day, because none was
   * recorded. Merging them would mean choosing an instant, and the only one
   * available is midnight — a new invented value, indistinguishable from a real
   * one once constructed.
   *
   * Present ONLY when modelStartDate is absent: a derived value never stands
   * beside a recorded one. Enough for the year (fuel vintage) and to anchor
   * Julian days; NOT enough for the sub-day ignition fraction.
   */
  derivedModelDate?: DerivedModelDate;
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
    notes?: string | null,
    /**
     * The range the model was simulated for, read from the MODEL (#482).
     *
     * Authoritative when present. The sim directory's `output-config.json` is
     * only a side effect of a run — it was the single copy of this value, which
     * is why runs predating `FireModel.timeRange` have no record of it at all.
     * Undefined means "the model does not know", and the legacy disk sources
     * are consulted then; it never means "use today".
     */
    modelTimeRange?: TimeRange
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

        // The year this fire was modelled for — drives fuel vintage display
        // in results (#319). Undefined when nothing on disk records it.
        const fuelVintage = await readFuelVintage(simDir);
        if (fuelVintage) {
          inputs.fuelVintage = fuelVintage;
        }

        // #482: the model's own record first; the sim directory only for runs
        // that predate the column. An unknown start still stays unknown.
        const modelStartDate = modelTimeRange?.start ?? (await readModelStartDate(simDir));
        if (modelStartDate) {
          inputs.modelStartDate = modelStartDate.toISOString();
        } else {
          // #482 half 2: nothing records the instant, so recover the DAY from
          // the engine's own output filenames and label it as derived. Only in
          // this branch — a derived value never competes with a recorded one.
          const derived = await readDerivedModelDate(simDir);
          if (derived) {
            inputs.derivedModelDate = derived;
          }
        }

        // Give the stored outputs their time coordinate (#418, closing
        // TODO #236-followup). The per-day `probability_*.tif` rasters are
        // already one result row each, carrying `julianDay` — they are a real
        // BP(x,t) series and the only reason a consumer could not use them as
        // one is that `timeOffsetHours` was hard-coded null above, because the
        // model's start day is not known until simDir has been resolved here.
        //
        // A second pass rather than a reordering: the start day depends on
        // simDir, simDir depends on a result's file path, and nothing is gained
        // by threading that through ninety lines of unrelated input loading.
        const seriesDays = outputs
          .map(o => o.metadata?.julianDay)
          .filter((d): d is number => typeof d === 'number');
        const startJulian = resolveSeriesStartJulian(seriesDays, modelStartDate);
        for (const output of outputs) {
          if (output.timeOffsetHours !== null) continue;
          const julianDay = output.metadata?.julianDay;
          output.timeOffsetHours = timeOffsetHoursForJulianDay(
            typeof julianDay === 'number' ? julianDay : null,
            startJulian,
          );
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

              // #482/#492: the model's range, resolved ONCE and hoisted, because
              // both the arrival output and the perimeter naming need it. It
              // was declared inside the try below and the perimeter block
              // referenced it anyway — which tsc caught as TS2552 while the
              // test suite only showed a swallowed ReferenceError and a
              // perimeter branch that silently never ran. Three gates, three
              // different answers.
              //
              // The model's own record first; the sim directory is the legacy
              // source for runs predating the column.
              const timeRange = modelTimeRange
                ? { start: modelTimeRange.start, end: modelTimeRange.end }
                : await readModelTimeRange(simDir);

              // Arrival raster output (#226) — emit one OutputItem pointing at
              // the classified tile endpoint. Classification window is derived
              // from the model's configured timeRange, not from file count.
              try {
                const arrival = this.gateway.findArrivalTifs(simDir);
                if (arrival) {
                  // The duration comes from the model's configured range, not
                  // from the number of arrival files (which can include a
                  // trailing boundary file).
                  //
                  // #482: `timeRange` is resolved above and shared with the
                  // perimeter naming. The MODEL's stored range is
                  // authoritative; the sim directory is the legacy source, read
                  // through readModelTimeRange so a missing or malformed config
                  // returns undefined instead of throwing — the inline
                  // JSON.parse(readFileSync(...)) that used to be here threw on
                  // a path it had just established might not exist, and the
                  // enclosing catch swallowed it, silently dropping the whole
                  // arrival output.

                  // #482: undefined when the start cannot be determined. Never a
                  // substituted year — see fallbackModelYear.ts for the ruling.
                  let startDate: string | undefined;
                  let startJulian = arrival.offsetDay;
                  let endJulian = arrival.endJulian;

                  if (timeRange) {
                    startDate = timeRange.start.toISOString();
                    startJulian = dayOfYear(timeRange.start);
                    endJulian = dayOfYear(timeRange.end);
                  } else if (modelStartDate) {
                    // A start with no end: the Julian window keeps its
                    // file-derived end rather than inventing one.
                    //
                    // #482: no weather.csv fallback beyond this. A year read off
                    // weather.csv cannot be made correct — its Date column is a
                    // BARE LOCAL timestamp and the declared zone lives in the
                    // very config file whose absence put us here (#479).
                    startDate = modelStartDate.toISOString();
                    startJulian = dayOfYear(modelStartDate);
                  }
                  // else: startDate stays undefined. An unknown start stays unknown.
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
                // Extract perimeters from arrival-time rasters.
                //
                // #492: the YEAR comes from the model and from nowhere else. A
                // Julian day is a position in a year and carries none of its
                // own, so with no recorded range the extractor returns
                // date: null and these are labelled by relative day below. It
                // used to regex a year out of weather.csv, and failing that
                // substitute today — naming a 2023 fire with the current year.
                const perimeterResult = await this.gateway.extractDeterministicPerimeters(
                  simDir,
                  timeRange?.start.getUTCFullYear(),
                );

                // Perimeter colors — progression from orange→red→crimson (no yellow)
                // Colorblind-friendly perimeter colors — high contrast, distinct hues
                const PERIMETER_COLORS = ['#e65100', '#1565c0', '#2e7d32', '#6a1b9a', '#c62828', '#00838f'];

                if (perimeterResult.success && perimeterResult.value.perimeters.length > 0) {
                  // #492: the relative-day base, so an unknown year reads
                  // "Day 1" and not "Day 170". The arrival legend sits directly
                  // above these in Model Outputs and labels its own bins
                  // relatively; day-of-year here would print "Day 1" and
                  // "Day 170" side by side for the same run.
                  const perimeterDayBase =
                    startJulianForPerimeters ??
                    Math.min(...perimeterResult.value.perimeters.map((p) => p.julianDay));

                  perimeterResult.value.perimeters.forEach((perimeter, index) => {
                    const dateLabel =
                      perimeter.date || `Day ${perimeter.julianDay - perimeterDayBase + 1}`;
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
                      timeOffsetHours: timeOffsetHoursForJulianDay(
                        perimeter.julianDay,
                        startJulianForPerimeters,
                      ),
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
