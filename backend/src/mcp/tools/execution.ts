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
} from '../../domain/entities/index.js';
import { TimeRange } from '../../domain/value-objects/index.js';
import type { WeatherConfig } from '../../infrastructure/weather/types.js';
import { getModelRepository, getResultRepository } from '../../infrastructure/database/index.js';
import { getFireSTARREngine } from '../../infrastructure/firestarr/FireSTARREngine.js';
import { getJobQueue } from '../../infrastructure/services/JobQueue.js';
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
      },
    },
    async ({ modelId }): Promise<CallToolResult> => {
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

      if (missing.length > 0) {
        return modelNotReady(modelId, missing);
      }

      // Build ExecutionOptions from config
      let ignitionGeometry: SpatialGeometry;
      try {
        const ignitionCfg = config!.ignition as { type: string; coordinates: unknown };
        if (ignitionCfg.type === 'point') {
          ignitionGeometry = new SpatialGeometry({
            type: GeometryType.Point,
            coordinates: ignitionCfg.coordinates as [number, number],
          });
        } else {
          ignitionGeometry = new SpatialGeometry({
            type: GeometryType.Polygon,
            coordinates: ignitionCfg.coordinates as [number, number][][],
          });
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

      const executionOptions = {
        ignitionGeometry,
        timeRange,
        weatherConfig,
      };

      // Get FireSTARR engine and initialize
      const engine = getFireSTARREngine();
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

      engine.execute(createFireModelId(modelId))
        .then(async () => {
          const results = await engine.getResults(createFireModelId(modelId));
          const resultRepo = getResultRepository();
          for (const result of results) {
            await resultRepo.save(result);
          }
          await jobQueue.complete(job.id);
          await repo.updateStatus(createFireModelId(modelId), ModelStatus.Completed);
        })
        .catch(async (err) => {
          const errMsg = err instanceof Error ? err.message : String(err);
          await jobQueue.fail(job.id, errMsg).catch(() => {});
          await repo.updateStatus(createFireModelId(modelId), ModelStatus.Failed).catch(() => {});
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
