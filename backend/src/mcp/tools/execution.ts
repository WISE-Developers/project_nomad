/**
 * MCP Tools — Model Execution
 *
 * Tools for executing fire models and checking job/result status via MCP.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
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
import { buildExecutionOptions } from '../../application/execution/buildExecutionOptions.js';
import type { ExecutionOptions } from '../../application/interfaces/IFireModelingEngine.js';
import {
  modelNotFound,
  jobNotFound,
  modelNotReady,
  modelAlreadyRunning,
  engineFailed,
} from '../errors.js';

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
    async ({ modelId, modelMode, scenarios }): Promise<CallToolResult> => {
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

      // Start execution in background with lifecycle management
      jobQueue.updateStatus(job.id, JobStatus.Running).catch(() => {});

      // The engine's reported state decides the outcome, not whether the
      // promise resolved. This previously treated execute() resolving as
      // success without ever calling getStatus(), so a run that finished in a
      // failed state was reported as completed; and it harvested before
      // completing, so a getResults() throw marked a successful simulation as
      // failed. Both now go through the same finalizer as the HTTP routes.
      void executeAndFinalizeModel({
        execute: async () => {
          await engine.execute(createFireModelId(modelId));
        },
        getStatus: () => engine.getStatus(createFireModelId(modelId)),
        completeJob: async () => {
          await jobQueue.complete(job.id);
        },
        failJob: async (reason) => {
          await jobQueue.fail(job.id, reason);
        },
        markModelCompleted: async () => {
          await repo.updateStatus(createFireModelId(modelId), ModelStatus.Completed);
        },
        markModelFailed: async () => {
          await repo.updateStatus(createFireModelId(modelId), ModelStatus.Failed);
        },
        harvestResults: async () => {
          const results = await engine.getResults(createFireModelId(modelId));
          const resultRepo = getResultRepository();
          for (const result of results) {
            await resultRepo.save(result);
          }
        },
        warn: (message) => console.warn(`[MCP] ${message} (model ${modelId})`),
      });

      // Update model status to queued
      await repo.updateStatus(createFireModelId(modelId), ModelStatus.Queued);

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
      description: 'Get a human-readable summary of the results for a completed fire model.',
      inputSchema: {
        modelId: z.string().describe('Model ID from create-model'),
      },
    },
    async ({ modelId }): Promise<CallToolResult> => {
      const repo = getModelRepository();
      const model = await repo.findById(createFireModelId(modelId));
      if (!model) return modelNotFound(modelId);

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
      description: 'Get structured result data for a completed fire model, including file paths and metadata.',
      inputSchema: {
        modelId: z.string().describe('Model ID from create-model'),
      },
    },
    async ({ modelId }): Promise<CallToolResult> => {
      const repo = getModelRepository();
      const model = await repo.findById(createFireModelId(modelId));
      if (!model) return modelNotFound(modelId);

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
