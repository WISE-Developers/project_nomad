/**
 * MCP Dynamic Resources
 *
 * Exposes live model, job, and result data as MCP resources that AI agents can read.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getModelRepository, getResultRepository } from '../../infrastructure/database/index.js';
import { getJobQueue } from '../../infrastructure/services/JobQueue.js';
import { createFireModelId, createJobId } from '../../domain/entities/index.js';

/**
 * Registers dynamic MCP resources.
 */
export function registerDynamicResources(server: McpServer): void {

  // ─── nomad://models ────────────────────────────────────────────
  // Lists all fire models with their status.
  server.registerResource(
    'models',
    'nomad://models',
    {
      title: 'Fire Models',
      description: 'List of all fire models with status.',
      mimeType: 'application/json',
    },
    async (): Promise<ReadResourceResult> => {
      const repo = getModelRepository();
      const result = await repo.find({}, { limit: 100, sortBy: 'createdAt', sortOrder: 'desc' });

      const models = result.models.map(m => ({
        id: m.id,
        name: m.name,
        engine: m.engineType,
        status: m.status,
        createdAt: m.createdAt.toISOString(),
      }));

      return {
        contents: [{
          uri: 'nomad://models',
          text: JSON.stringify({ models, totalCount: result.totalCount }, null, 2),
          mimeType: 'application/json',
        }],
      };
    }
  );

  // ─── nomad://models/{modelId} ──────────────────────────────────
  // Detailed view of a specific model.
  const modelDetailTemplate = new ResourceTemplate(
    'nomad://models/{modelId}',
    {
      list: async () => {
        const repo = getModelRepository();
        const result = await repo.find({}, { limit: 100 });
        return {
          resources: result.models.map(m => ({
            uri: `nomad://models/${m.id}`,
            name: m.name,
            mimeType: 'application/json',
          })),
        };
      },
    }
  );

  server.registerResource(
    'model-detail',
    modelDetailTemplate,
    {
      title: 'Fire Model Detail',
      description: 'Detailed view of a specific fire model.',
      mimeType: 'application/json',
    },
    async (uri, variables): Promise<ReadResourceResult> => {
      const modelId = variables.modelId as string;
      const repo = getModelRepository();
      const model = await repo.findById(createFireModelId(modelId));

      if (!model) {
        return {
          contents: [{
            uri: uri.toString(),
            text: JSON.stringify({ error: 'Model not found', modelId }),
            mimeType: 'application/json',
          }],
        };
      }

      return {
        contents: [{
          uri: uri.toString(),
          text: JSON.stringify({
            id: model.id,
            name: model.name,
            engine: model.engineType,
            status: model.status,
            createdAt: model.createdAt.toISOString(),
            updatedAt: model.updatedAt.toISOString(),
          }, null, 2),
          mimeType: 'application/json',
        }],
      };
    }
  );

  // ─── nomad://jobs/{jobId} ──────────────────────────────────────
  // Live status of a specific execution job.
  const jobDetailTemplate = new ResourceTemplate(
    'nomad://jobs/{jobId}',
    { list: undefined }
  );

  server.registerResource(
    'job-detail',
    jobDetailTemplate,
    {
      title: 'Job Status',
      description: 'Live status and progress of a fire model execution job.',
      mimeType: 'application/json',
    },
    async (uri, variables): Promise<ReadResourceResult> => {
      const jobId = variables.jobId as string;
      const queue = getJobQueue();
      const result = await queue.getJob(createJobId(jobId));

      if (!result.success) {
        return {
          contents: [{
            uri: uri.toString(),
            text: JSON.stringify({ error: 'Job not found', jobId }),
            mimeType: 'application/json',
          }],
        };
      }

      const job = result.value;
      return {
        contents: [{
          uri: uri.toString(),
          text: JSON.stringify({
            id: job.id,
            modelId: job.modelId,
            status: job.status,
            progress: job.progress,
            createdAt: job.createdAt.toISOString(),
            ...(job.startedAt && { startedAt: job.startedAt.toISOString() }),
            ...(job.completedAt && { completedAt: job.completedAt.toISOString() }),
            ...(job.error && { error: job.error }),
            resultIds: job.resultIds,
          }, null, 2),
          mimeType: 'application/json',
        }],
      };
    }
  );

  // ─── nomad://models/{modelId}/results ─────────────────────────
  // Result inventory for a specific model.
  const modelResultsTemplate = new ResourceTemplate(
    'nomad://models/{modelId}/results',
    { list: undefined }
  );

  server.registerResource(
    'model-results',
    modelResultsTemplate,
    {
      title: 'Model Results',
      description: 'Result inventory for a specific fire model execution.',
      mimeType: 'application/json',
    },
    async (uri, variables): Promise<ReadResourceResult> => {
      const modelId = variables.modelId as string;
      const resultRepo = getResultRepository();
      const results = await resultRepo.findByModelId(createFireModelId(modelId));

      return {
        contents: [{
          uri: uri.toString(),
          text: JSON.stringify({
            modelId,
            resultCount: results.length,
            results: results.map(r => ({
              id: r.id,
              outputType: r.outputType,
              format: r.format,
              createdAt: r.createdAt.toISOString(),
              displayName: r.getDisplayName(),
              hasGeometry: r.hasGeometry(),
              metadata: r.metadata,
            })),
          }, null, 2),
          mimeType: 'application/json',
        }],
      };
    }
  );
}
