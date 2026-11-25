/**
 * MCP Tools — Model Execution
 *
 * Tools for executing fire models and checking job/result status via MCP.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  type FireModel,
  createFireModelId,
  ModelStatus,
  createJobId,
  JobStatus,
  SpatialGeometry,
  GeometryType,
  EngineType,
} from '../../domain/entities/index.js';
import { TimeRange } from '../../domain/value-objects/index.js';
import type { WeatherConfig } from '../../infrastructure/weather/types.js';
import { getModelRepository, getResultRepository } from '../../infrastructure/database/index.js';
import { getEngine } from '../../infrastructure/engines/index.js';
import { getJobQueue } from '../../infrastructure/services/JobQueue.js';
import { executeAndFinalizeModel } from '../../application/services/executeAndFinalizeModel.js';
import { getRunRegistry } from '../../application/services/runRegistry.js';
import { buildExecutionOptions } from '../../application/execution/buildExecutionOptions.js';
import type { ExecutionOptions } from '../../application/interfaces/IFireModelingEngine.js';
import {
  modelNotFound,
  jobNotFound,
  modelNotReady,
  modelAlreadyRunning,
  engineFailed,
} from '../errors.js';
import { getModelResultsService } from '../../application/services/index.js';

/**
 * Make sure the model's derived deterministic products exist as result rows
 * before reading the repository (#536).
 *
 * `get-results-summary` and `get-results-data` read `findByModelId`, and the
 * perimeter and arrival-time products are derived rather than written by the
 * engine's output parser. Asking the application service for the model's results
 * is what derives and persists them.
 *
 * Without this call the rows would appear to an MCP caller only after a human had
 * opened that model in the browser — the GUI reader being the only thing that
 * triggered persistence. That is a worse failure than the one #536 fixes: it
 * presents as intermittent, and the hidden variable is someone else's browsing.
 *
 * Swallowed on failure on purpose. These products are an additional view of a
 * completed model; a derivation that cannot run (no GDAL, an unreadable sim
 * directory) must leave the probability rows reachable rather than turning a
 * working tool into an error.
 */
async function ensureDerivedResultRows(model: FireModel): Promise<void> {
  try {
    // `engineType` is required on FireModelProps, so there is no default to fall
    // back to here — a `?? EngineType.FireSTARR` would be a branch that can never
    // run, which tsc said plainly while 1608 passing tests did not.
    const engine = getEngine(model.engineType);
    const resultsService = getModelResultsService(engine);
    await resultsService.getResults(model.id, model.name, model.engineType);
  } catch (e) {
    console.warn(
      `[mcp/execution] Could not derive result rows for ${model.id}; reporting stored rows only:`,
      e,
    );
  }
}

/**
 * Registers execution tools on the MCP server.
 */
export function registerExecutionTools(server: McpServer): void {

  // ─── execute-model ─────────────────────────────────────────────
  server.registerTool(
    'execute-model',
    {
      title: 'Execute Fire Model',
      description: 'Submit a configured fire model for execution. The model must have ignition, weather, and simulation time set. Returns a job ID for tracking progress.',
      inputSchema: {
        modelId: z.string().describe('Model ID to execute'),
        /**
         * Parity with the GUI and with POST /models/run. Omitted previously,
         * so every MCP run silently took the probabilistic default (#151).
         *
         * `outputMode` is deliberately NOT exposed here: the GUI does not let a
         * user set it independently either — ModelSelectionStep derives it from
         * modelMode. Exposing it would be a knob the GUI does not have, which is
         * divergence wearing parity's clothes.
         */
        modelMode: z
          .enum(['probabilistic', 'deterministic'])
          .optional()
          .describe(
            'Model mode. Defaults to probabilistic. Deterministic produces vector ' +
              'perimeters from a single simulation; probabilistic produces rasters.',
          ),
        scenarios: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'Number of simulations. Defaults to the count the GUI would send: ' +
              '100 for probabilistic, 1 for deterministic.',
          ),
      },
    },
    async ({ modelId, modelMode, scenarios }): Promise<CallToolResult> =>
      submitModelForExecution({ modelId, modelMode, scenarios })
  );

  // ─── get-job-status ────────────────────────────────────────────
  server.registerTool(
    'get-job-status',
    {
      title: 'Get Job Status',
      description: 'Check the execution status and progress of a submitted job.',
      inputSchema: {
        jobId: z.string().describe('Job ID from execute-model'),
      },
    },
    async ({ jobId }): Promise<CallToolResult> => {
      const jobQueue = getJobQueue();
      const result = await jobQueue.getJob(createJobId(jobId));

      if (!result.success) {
        return jobNotFound(jobId);
      }

      const job = result.value;
      const response: Record<string, unknown> = {
        jobId: job.id,
        modelId: job.modelId,
        status: job.status,
        progress: job.progress,
        createdAt: job.createdAt.toISOString(),
      };

      if (job.startedAt) response.startedAt = job.startedAt.toISOString();
      if (job.completedAt) response.completedAt = job.completedAt.toISOString();
      if (job.error) response.error = job.error;
      if (job.resultIds.length > 0) response.resultIds = job.resultIds;

      // Add a human-friendly message based on status
      switch (job.status) {
        case JobStatus.Pending:
          response.message = 'Job is queued and waiting for execution.';
          break;
        case JobStatus.Running:
          response.message = `Job is running. Progress: ${job.progress}%.`;
          break;
        case JobStatus.Completed:
          response.message = 'Job completed successfully. Results are available.';
          break;
        case JobStatus.Failed:
          response.message = `Job failed: ${job.error ?? 'Unknown error'}.`;
          break;
        case JobStatus.Cancelled:
          response.message = 'Job was cancelled.';
          break;
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(response, null, 2),
        }],
      };
    }
  );

  // ─── get-results-summary ───────────────────────────────────────
  server.registerTool(
    'get-results-summary',
    {
      title: 'Get Results Summary',
      description: 'Get a human-readable summary of the results for a completed fire model. For a deterministic run this includes the vector fire perimeters and the arrival-time raster, not only the probability rasters (#536).',
      inputSchema: {
        modelId: z.string().describe('Model ID from create-model'),
      },
    },
    async ({ modelId }): Promise<CallToolResult> => {
      const repo = getModelRepository();
      const model = await repo.findById(createFireModelId(modelId));
      if (!model) return modelNotFound(modelId);

      // #536: derive and persist the perimeter / arrival-time rows first.
      await ensureDerivedResultRows(model);

      const resultRepo = getResultRepository();
      const results = await resultRepo.findByModelId(createFireModelId(modelId));

      if (results.length === 0) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              modelId,
              modelName: model.name,
              status: model.status,
              message: model.status === ModelStatus.Completed
                ? 'Model completed but no results were found.'
                : `Model has not completed yet. Current status: ${model.status}.`,
              resultCount: 0,
            }, null, 2),
          }],
        };
      }

      // Aggregate result metadata for summary
      const outputTypes = [...new Set(results.map(r => r.outputType))];
      const formats = [...new Set(results.map(r => r.format))];
      const dates = results
        .map(r => r.metadata.simulationDate)
        .filter(Boolean);
      const totalAreaHectares = results.reduce((sum, r) => sum + (r.metadata.areaHectares ?? 0), 0);
      const createdDates = results.map(r => r.createdAt);
      const earliestCreated = new Date(Math.min(...createdDates.map(d => d.getTime())));
      const latestCreated = new Date(Math.max(...createdDates.map(d => d.getTime())));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            modelId,
            modelName: model.name,
            status: model.status,
            resultCount: results.length,
            outputTypes,
            formats,
            simulationDates: [...new Set(dates)].sort(),
            totalAreaHectares: totalAreaHectares > 0 ? totalAreaHectares : undefined,
            firstResultAt: earliestCreated.toISOString(),
            lastResultAt: latestCreated.toISOString(),
            message: `Model '${model.name}' has ${results.length} result(s): ${outputTypes.join(', ')}.`,
          }, null, 2),
        }],
      };
    }
  );

  // ─── get-results-data ──────────────────────────────────────────
  server.registerTool(
    'get-results-data',
    {
      title: 'Get Results Data',
      description: 'Get structured result data for a completed fire model, including file paths and metadata. A deterministic run also returns one perimeter row per simulation day, each carrying its GeoJSON geometry in metadata, and an arrival-time raster row (#536).',
      inputSchema: {
        modelId: z.string().describe('Model ID from create-model'),
      },
    },
    async ({ modelId }): Promise<CallToolResult> => {
      const repo = getModelRepository();
      const model = await repo.findById(createFireModelId(modelId));
      if (!model) return modelNotFound(modelId);

      // #536: derive and persist the perimeter / arrival-time rows first. Both
      // result tools do this — a fix applied to one member of a class is not
      // applied to the other, and these two are read interchangeably.
      await ensureDerivedResultRows(model);

      const resultRepo = getResultRepository();
      const results = await resultRepo.findByModelId(createFireModelId(modelId));

      if (results.length === 0) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              modelId,
              modelName: model.name,
              status: model.status,
              results: [],
              message: model.status === ModelStatus.Completed
                ? 'No results found for this model.'
                : `Model has not completed yet. Current status: ${model.status}.`,
            }, null, 2),
          }],
        };
      }

      const resultData = results.map(r => ({
        id: r.id,
        outputType: r.outputType,
        format: r.format,
        filePath: r.metadata.filePath,
        metadata: r.metadata,
        createdAt: r.createdAt.toISOString(),
      }));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            modelId,
            modelName: model.name,
            status: model.status,
            results: resultData,
          }, null, 2),
        }],
      };
    }
  );
}


/**
 * Submits one configured model for execution and returns the tool result.
 *
 * Extracted from the `execute-model` handler so `batch-execute` (#167 phase 4)
 * drives the SAME path rather than a second copy of it. A sibling copy is the
 * shape that let an unsupported ignition type run as a polygon in three places
 * at once; there is one implementation here on purpose.
 */
export async function submitModelForExecution({
  modelId,
  modelMode,
  scenarios,
}: {
  modelId: string;
  modelMode?: 'probabilistic' | 'deterministic';
  scenarios?: number;
}): Promise<CallToolResult> {
      const repo = getModelRepository();
      const model = await repo.findById(createFireModelId(modelId));
      if (!model) return modelNotFound(modelId);

      // Check model can be executed
      if (model.status === ModelStatus.Running || model.status === ModelStatus.Queued) {
        return modelAlreadyRunning(modelId);
      }

      // Read config_json and check completeness
      const config = await repo.getConfigJson(createFireModelId(modelId));
      const missing: string[] = [];
      if (!config?.ignition) missing.push('ignition');
      if (!config?.weather) missing.push('weather');
      if (!config?.timeRange) missing.push('simulation-time');
      if (!config?.timezone) missing.push('timezone');

      if (missing.length > 0) {
        return modelNotReady(modelId, missing);
      }

      // Build ExecutionOptions from config
      let ignitionGeometry: SpatialGeometry;
      try {
        const ignitionCfg = config!.ignition as { type: string; coordinates: unknown };
        // Exhaustive by construction. The previous form was
        // `if (type === 'point') … else → Polygon`, which SILENTLY RAN a
        // linestring ignition as a polygon and reported success — the same
        // missing-else shape as #432, which existed in three copies. An
        // unrecognised type must refuse, never fall through.
        switch (ignitionCfg.type) {
          case 'point':
            ignitionGeometry = new SpatialGeometry({
              type: GeometryType.Point,
              coordinates: ignitionCfg.coordinates as [number, number],
            });
            break;
          case 'linestring':
            ignitionGeometry = new SpatialGeometry({
              type: GeometryType.LineString,
              coordinates: ignitionCfg.coordinates as [number, number][],
            });
            break;
          case 'polygon':
            ignitionGeometry = new SpatialGeometry({
              type: GeometryType.Polygon,
              coordinates: ignitionCfg.coordinates as [number, number][][],
            });
            break;
          default:
            return engineFailed(
              `Unsupported ignition type in config: '${ignitionCfg.type}'. ` +
                `Expected one of: point, linestring, polygon.`,
            );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return engineFailed(`Invalid ignition geometry in config: ${msg}`);
      }

      let timeRange: TimeRange;
      try {
        const tr = config!.timeRange as { start: string; end: string };
        timeRange = TimeRange.fromISO(tr.start, tr.end);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return engineFailed(`Invalid time range in config: ${msg}`);
      }

      const weatherConfig = config!.weather as WeatherConfig;
      const timezone = config!.timezone as string;

      // Single shared derivation — the same builder both HTTP endpoints use.
      // This literal previously omitted simulationCount and outputMode entirely,
      // so every MCP run silently took the probabilistic default. It was not a
      // type error because every parity-relevant field on ExecutionOptions is
      // optional; `ExecutionRequest` below requires each key, so a future option
      // cannot reach the engine from one caller and not another.
      const executionOptions: ExecutionOptions = buildExecutionOptions({
        ignitionGeometry,
        timeRange,
        timezone,
        weatherConfig,
        modelMode,
        scenarios,
      });

      // Get the engine and initialize
      const engine = getEngine(EngineType.FireSTARR);
      try {
        await engine.initialize(model, executionOptions);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return engineFailed(`Engine initialization failed: ${msg}`);
      }

      // Enqueue a job
      const jobQueue = getJobQueue();
      const jobResult = await jobQueue.enqueue(createFireModelId(modelId));
      if (!jobResult.success) {
        return engineFailed('Failed to create execution job.');
      }
      const job = jobResult.value;

      // Registered before the next await, so a cancel can always find this run.
      const run = getRunRegistry().register(job.id, createFireModelId(modelId));

      // AWAITED (finding F4 of verification/job-lifecycle). This was fired with
      // `.catch(() => {})` and never awaited, so nothing ordered it against the
      // finalizer's Completed/Failed write: on a slow database and a fast engine failure,
      // the late "running" write landed last and the finished job said running forever.
      // Refused when a cancel already took the job, and then nothing is launched.
      if (!(await jobQueue.updateStatus(job.id, JobStatus.Running)).success) {
        run.release();
        return engineFailed('The job was cancelled before it started.');
      }

      // The MODEL is running too, not only the job (#514), and it is recorded BEFORE the
      // execution is launched. This replaces a `ModelStatus.Queued` write that used to sit
      // after the `void executeAndFinalizeModel(...)` call below — which was both the wrong
      // value once execution had begun and a race, since nothing ordered it against the
      // finalizer's own Completed/Failed write. Never over a cancel's write.
      await repo.updateStatusUnlessCancelled(createFireModelId(modelId), ModelStatus.Running);

      // The engine's reported state decides the outcome, not whether the
      // promise resolved. This previously treated execute() resolving as
      // success without ever calling getStatus(), so a run that finished in a
      // failed state was reported as completed; and it harvested before
      // completing, so a getResults() throw marked a successful simulation as
      // failed. Both now go through the same finalizer as the HTTP routes.
      void executeAndFinalizeModel({
        execute: async () => {
          await engine.execute(createFireModelId(modelId), { signal: run.signal });
        },
        getStatus: () => engine.getStatus(createFireModelId(modelId)),
        stoppedByCancel: () => run.stoppedByCancel(),
        completeJob: async () => (await jobQueue.complete(job.id)).success,
        failJob: async (reason) => (await jobQueue.fail(job.id, reason)).success,
        markModelCompleted: async () => {
          await repo.updateStatusUnlessCancelled(createFireModelId(modelId), ModelStatus.Completed);
        },
        markModelFailed: async () => {
          await repo.updateStatusUnlessCancelled(createFireModelId(modelId), ModelStatus.Failed);
        },
        harvestResults: async () => {
          const results = await engine.getResults(createFireModelId(modelId));
          const resultRepo = getResultRepository();
          for (const result of results) {
            await resultRepo.save(result);
          }
        },
        warn: (message) => console.warn(`[MCP] ${message} (model ${modelId})`),
      }).finally(() => run.release());

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            modelId,
            jobId: job.id,
            status: 'queued',
            message: `Model '${model.name}' submitted for execution on FireSTARR. Use get-job-status to track progress.`,
          }, null, 2),
        }],
      };
}