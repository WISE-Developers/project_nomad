/**
 * MCP Execution Tools — Unit Tests
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerModelTools } from '../../tools/models.js';
import { registerExecutionTools } from '../../tools/execution.js';
import {
  FireModel,
  createFireModelId,
  ModelStatus,
  ModelResult,
  createModelResultId,
  OutputType,
  OutputFormat,
  Job,
  createJobId,
  JobStatus,
} from '../../../domain/entities/index.js';
import { Result } from '../../../application/common/index.js';
import { NotFoundError } from '../../../domain/errors/index.js';

// ─── Mock data stores ───────────────────────────────────────────
const mockModels = new Map<string, FireModel>();
const mockConfigs = new Map<string, Record<string, unknown>>();
const mockJobs = new Map<string, Job>();
const mockResults = new Map<string, ModelResult[]>();

vi.mock('../../../infrastructure/database/index.js', () => ({
  getResultRepository: () => ({
    save: vi.fn(async () => {}),
    findByModelId: vi.fn(async (modelId: string) => mockResults.get(modelId) ?? []),
  }),
  getModelRepository: () => ({
    save: vi.fn(async (model: FireModel) => {
      mockModels.set(model.id, model);
      return model;
    }),
    findById: vi.fn(async (id: string) => mockModels.get(id) ?? null),
    find: vi.fn(async () => ({
      models: Array.from(mockModels.values()),
      totalCount: mockModels.size,
      hasMore: false,
    })),
    updateStatus: vi.fn(async (id: string, status: ModelStatus) => {
      const model = mockModels.get(id);
      if (!model) throw new Error('Not found');
      const updated = model.withStatus(status);
      mockModels.set(id, updated);
      return updated;
    }),
    getConfigJson: vi.fn(async (id: string) => mockConfigs.get(id) ?? null),
    saveConfigJson: vi.fn(async (id: string, config: Record<string, unknown>) => {
      mockConfigs.set(id, config);
    }),
    getResults: vi.fn(async (modelId: string) => mockResults.get(modelId) ?? []),
  }),
}));

vi.mock('../../../infrastructure/firestarr/FireSTARREngine.js', () => ({
  getFireSTARREngine: () => ({
    initialize: vi.fn(async () => { /* no-op */ }),
    execute: vi.fn(async () => { /* no-op */ }),
    getResults: vi.fn(async () => []),
  }),
}));

vi.mock('../../../infrastructure/services/JobQueue.js', () => ({
  getJobQueue: () => ({
    getJob: vi.fn(async (jobId: string) => {
      const job = mockJobs.get(jobId);
      if (!job) return Result.fail(new NotFoundError('Job', jobId));
      return Result.ok(job);
    }),
    enqueue: vi.fn(async (modelId: string) => {
      const jobId = createJobId('test-job-' + Date.now());
      const job = new Job({ id: jobId, modelId: createFireModelId(modelId), status: JobStatus.Pending });
      mockJobs.set(jobId, job);
      return Result.ok(job);
    }),
    updateStatus: vi.fn(async () => Result.ok(undefined)),
    complete: vi.fn(async () => Result.ok(undefined)),
    fail: vi.fn(async () => Result.ok(undefined)),
  }),
}));

describe('MCP Execution Tools', () => {
  let client: Client;
  let server: McpServer;

  beforeAll(async () => {
    server = new McpServer(
      { name: 'test-server', version: '1.0.0' },
      { capabilities: { logging: {} } }
    );
    registerModelTools(server);
    registerExecutionTools(server);

    client = new Client({ name: 'test-client', version: '1.0.0' });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
  });

  beforeEach(() => {
    mockModels.clear();
    mockConfigs.clear();
    mockJobs.clear();
    mockResults.clear();
  });

  // Helper: create and fully configure a model via tools
  async function createConfiguredModel(): Promise<string> {
    const createResult = await client.callTool({
      name: 'create-model',
      arguments: { name: 'Execution Test' },
    });
    const { modelId } = JSON.parse((createResult.content as Array<{ text: string }>)[0].text);

    await client.callTool({
      name: 'set-ignition',
      arguments: { modelId, type: 'point', coordinates: [-114.3, 62.5] },
    });
    await client.callTool({
      name: 'set-weather',
      arguments: {
        modelId,
        source: 'firestarr_csv',
        firestarrCsvContent: 'datetime,temp\n2026-06-15T14:00:00Z,30',
      },
    });
    await client.callTool({
      name: 'set-simulation-time',
      arguments: {
        modelId,
        startTime: '2026-06-15T14:00:00Z',
        endTime: '2026-06-15T20:00:00Z',
      },
    });

    return modelId;
  }

  // ─── execute-model ───────────────────────────────────────────
  describe('execute-model', () => {
    it('executes a fully configured model', async () => {
      const modelId = await createConfiguredModel();

      const result = await client.callTool({
        name: 'execute-model',
        arguments: { modelId },
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.modelId).toBe(modelId);
      expect(data.jobId).toBeDefined();
      expect(data.status).toBe('queued');
    });

    it('rejects execution of non-existent model', async () => {
      const result = await client.callTool({
        name: 'execute-model',
        arguments: { modelId: 'nonexistent' },
      });

      expect(result.isError).toBe(true);
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.code).toBe('MODEL_NOT_FOUND');
    });

    it('rejects execution of unconfigured model (missing ignition, weather, time)', async () => {
      const createResult = await client.callTool({
        name: 'create-model',
        arguments: { name: 'Incomplete Model' },
      });
      const { modelId } = JSON.parse((createResult.content as Array<{ text: string }>)[0].text);

      const result = await client.callTool({
        name: 'execute-model',
        arguments: { modelId },
      });

      expect(result.isError).toBe(true);
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.code).toBe('MODEL_NOT_READY');
      expect(data.message).toContain('ignition');
      expect(data.message).toContain('weather');
      expect(data.message).toContain('simulation-time');
    });

    it('rejects execution of already-running model', async () => {
      const modelId = await createConfiguredModel();
      // Manually set model to Running state
      const model = mockModels.get(modelId);
      if (model) mockModels.set(modelId, model.withStatus(ModelStatus.Running));

      const result = await client.callTool({
        name: 'execute-model',
        arguments: { modelId },
      });

      expect(result.isError).toBe(true);
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.code).toBe('MODEL_ALREADY_RUNNING');
    });
  });

  // ─── get-job-status ──────────────────────────────────────────
  describe('get-job-status', () => {
    it('returns status for an existing job', async () => {
      const jobId = createJobId('status-test-job');
      mockJobs.set(jobId, new Job({
        id: jobId,
        modelId: createFireModelId('some-model'),
        status: JobStatus.Running,
        progress: 45,
      }));

      const result = await client.callTool({
        name: 'get-job-status',
        arguments: { jobId },
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.jobId).toBe(jobId);
      expect(data.status).toBe('running');
      expect(data.progress).toBe(45);
      expect(data.message).toContain('45%');
    });

    it('returns error for non-existent job', async () => {
      const result = await client.callTool({
        name: 'get-job-status',
        arguments: { jobId: 'nonexistent' },
      });

      expect(result.isError).toBe(true);
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.code).toBe('JOB_NOT_FOUND');
    });
  });

  // ─── get-results-summary ─────────────────────────────────────
  describe('get-results-summary', () => {
    it('returns message when model has no results yet', async () => {
      const createResult = await client.callTool({
        name: 'create-model',
        arguments: { name: 'No Results Model' },
      });
      const { modelId } = JSON.parse((createResult.content as Array<{ text: string }>)[0].text);

      const result = await client.callTool({
        name: 'get-results-summary',
        arguments: { modelId },
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.resultCount).toBe(0);
      expect(data.message).toBeDefined();
    });

    it('returns summary when model has results', async () => {
      const createResult = await client.callTool({
        name: 'create-model',
        arguments: { name: 'Has Results Model' },
      });
      const { modelId } = JSON.parse((createResult.content as Array<{ text: string }>)[0].text);

      // Update model to completed status
      const model = mockModels.get(modelId);
      if (model) mockModels.set(modelId, model.withStatus(ModelStatus.Completed));

      // Seed results
      mockResults.set(modelId, [
        new ModelResult({
          id: createModelResultId('r1'),
          fireModelId: createFireModelId(modelId),
          outputType: OutputType.Probability,
          format: OutputFormat.GeoTIFF,
          metadata: { simulationDate: '2026-06-15', areaHectares: 150 },
          createdAt: new Date('2026-06-15T21:00:00Z'),
        }),
        new ModelResult({
          id: createModelResultId('r2'),
          fireModelId: createFireModelId(modelId),
          outputType: OutputType.Perimeter,
          format: OutputFormat.GeoJSON,
          metadata: { simulationDate: '2026-06-15' },
          createdAt: new Date('2026-06-15T21:00:00Z'),
        }),
      ]);

      const result = await client.callTool({
        name: 'get-results-summary',
        arguments: { modelId },
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.resultCount).toBe(2);
      expect(data.outputTypes).toContain('probability');
      expect(data.outputTypes).toContain('perimeter');
      expect(data.totalAreaHectares).toBe(150);
    });

    it('returns error for non-existent model', async () => {
      const result = await client.callTool({
        name: 'get-results-summary',
        arguments: { modelId: 'nonexistent' },
      });

      expect(result.isError).toBe(true);
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.code).toBe('MODEL_NOT_FOUND');
    });
  });

  // ─── get-results-data ────────────────────────────────────────
  describe('get-results-data', () => {
    it('returns structured result data when results exist', async () => {
      const createResult = await client.callTool({
        name: 'create-model',
        arguments: { name: 'Data Results Model' },
      });
      const { modelId } = JSON.parse((createResult.content as Array<{ text: string }>)[0].text);

      const model = mockModels.get(modelId);
      if (model) mockModels.set(modelId, model.withStatus(ModelStatus.Completed));

      mockResults.set(modelId, [
        new ModelResult({
          id: createModelResultId('result-1'),
          fireModelId: createFireModelId(modelId),
          outputType: OutputType.Probability,
          format: OutputFormat.GeoTIFF,
          metadata: { filePath: '/output/prob.tif', simulationDate: '2026-06-15' },
          createdAt: new Date('2026-06-15T21:00:00Z'),
        }),
      ]);

      const result = await client.callTool({
        name: 'get-results-data',
        arguments: { modelId },
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.results).toHaveLength(1);
      expect(data.results[0].id).toBe('result-1');
      expect(data.results[0].outputType).toBe('probability');
      expect(data.results[0].format).toBe('geotiff');
      expect(data.results[0].filePath).toBe('/output/prob.tif');
    });

    it('returns empty results when model is still running', async () => {
      const createResult = await client.callTool({
        name: 'create-model',
        arguments: { name: 'Running Model' },
      });
      const { modelId } = JSON.parse((createResult.content as Array<{ text: string }>)[0].text);

      const model = mockModels.get(modelId);
      if (model) mockModels.set(modelId, model.withStatus(ModelStatus.Running));

      const result = await client.callTool({
        name: 'get-results-data',
        arguments: { modelId },
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.results).toHaveLength(0);
      expect(data.message).toBeDefined();
    });

    it('returns error for non-existent model', async () => {
      const result = await client.callTool({
        name: 'get-results-data',
        arguments: { modelId: 'nonexistent' },
      });

      expect(result.isError).toBe(true);
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.code).toBe('MODEL_NOT_FOUND');
    });
  });
});
