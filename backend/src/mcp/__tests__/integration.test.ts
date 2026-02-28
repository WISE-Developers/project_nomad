/**
 * MCP Server Integration Test
 *
 * Tests the full MCP server lifecycle: session init, tool calls, resource reads.
 * Uses in-memory transport (no HTTP) for speed and isolation.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerAllTools } from '../tools/index.js';
import { registerAllResources } from '../resources/index.js';
import {
  FireModel,
  ModelStatus,
  Job,
  createJobId,
  JobStatus,
} from '../../domain/entities/index.js';
import { Result } from '../../application/common/index.js';
import { NotFoundError } from '../../domain/errors/index.js';

// ─── Mock data stores ───────────────────────────────────────────
const mockModels = new Map<string, FireModel>();
const mockConfigs = new Map<string, Record<string, unknown>>();
const mockJobs = new Map<string, Job>();

vi.mock('../../infrastructure/database/index.js', () => ({
  getResultRepository: () => ({
    save: vi.fn(async () => {}),
    findByModelId: vi.fn(async () => []),
  }),
  getModelRepository: () => ({
    save: vi.fn(async (model: FireModel) => {
      mockModels.set(model.id, model);
      return model;
    }),
    findById: vi.fn(async (id: string) => mockModels.get(id) ?? null),
    find: vi.fn(async (_filter: unknown, options?: { limit?: number }) => ({
      models: Array.from(mockModels.values()).slice(0, options?.limit ?? 100),
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
    getResults: vi.fn(async () => []),
  }),
}));

vi.mock('../../infrastructure/firestarr/FireSTARREngine.js', () => ({
  getFireSTARREngine: () => ({
    initialize: vi.fn(async () => { /* no-op */ }),
    execute: vi.fn(async () => { /* no-op */ }),
    getResults: vi.fn(async () => []),
  }),
}));

vi.mock('../../infrastructure/services/JobQueue.js', () => ({
  getJobQueue: () => ({
    getJob: vi.fn(async (jobId: string) => {
      const job = mockJobs.get(jobId);
      if (!job) return Result.fail(new NotFoundError('Job', jobId));
      return Result.ok(job);
    }),
    enqueue: vi.fn(async (modelId: string) => {
      const jobId = createJobId('integration-job-' + Date.now());
      const { createFireModelId } = await import('../../domain/entities/index.js');
      const job = new Job({ id: jobId, modelId: createFireModelId(modelId), status: JobStatus.Pending });
      mockJobs.set(jobId, job);
      return Result.ok(job);
    }),
    updateStatus: vi.fn(async () => Result.ok(undefined)),
    complete: vi.fn(async () => Result.ok(undefined)),
    fail: vi.fn(async () => Result.ok(undefined)),
  }),
}));

describe('MCP Server Integration', () => {
  let client: Client;
  let server: McpServer;

  beforeAll(async () => {
    server = new McpServer(
      { name: 'nomad-fire-modeling', version: '1.0.0' },
      { capabilities: { logging: {} } }
    );
    registerAllTools(server);
    registerAllResources(server);

    client = new Client({ name: 'integration-test', version: '1.0.0' });

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
  });

  // ─── Tool Discovery ──────────────────────────────────────────
  describe('tool discovery', () => {
    it('lists all 9 tools', async () => {
      const tools = await client.listTools();

      const toolNames = tools.tools.map(t => t.name).sort();
      expect(toolNames).toEqual([
        'create-model',
        'execute-model',
        'get-job-status',
        'get-results-data',
        'get-results-summary',
        'list-models',
        'set-ignition',
        'set-simulation-time',
        'set-weather',
      ]);
    });
  });

  // ─── Resource Discovery ──────────────────────────────────────
  describe('resource discovery', () => {
    it('lists nomad://models resource', async () => {
      const resources = await client.listResources();

      const uris = resources.resources.map(r => r.uri);
      expect(uris).toContain('nomad://models');
    });
  });

  // ─── End-to-End Workflow ─────────────────────────────────────
  describe('end-to-end: create → configure → execute', () => {
    it('completes the full fire modeling workflow', async () => {
      // 1. Create model
      const createResult = await client.callTool({
        name: 'create-model',
        arguments: { name: 'Highway 3 Fire — Boreal Spruce' },
      });
      expect(createResult.isError).toBeFalsy();
      const { modelId } = JSON.parse((createResult.content as Array<{ text: string }>)[0].text);
      expect(modelId).toBeDefined();

      // 2. Set ignition — Yellowknife area (point, GeoJSON order: [lon, lat])
      const ignitionResult = await client.callTool({
        name: 'set-ignition',
        arguments: {
          modelId,
          type: 'point',
          coordinates: [-114.372, 62.454],
        },
      });
      expect(ignitionResult.isError).toBeFalsy();

      // 3. Set weather — FireSTARR CSV source
      const weatherResult = await client.callTool({
        name: 'set-weather',
        arguments: {
          modelId,
          source: 'firestarr_csv',
          firestarrCsvContent: 'datetime,temp,rh,ws,wd,precip\n2026-06-15T14:00:00Z,30,20,25,270,0',
        },
      });
      expect(weatherResult.isError).toBeFalsy();

      // 4. Set simulation time — 6 hours
      const timeResult = await client.callTool({
        name: 'set-simulation-time',
        arguments: {
          modelId,
          startTime: '2026-06-15T14:00:00Z',
          endTime: '2026-06-15T20:00:00Z',
        },
      });
      expect(timeResult.isError).toBeFalsy();

      // 5. Execute
      const execResult = await client.callTool({
        name: 'execute-model',
        arguments: { modelId },
      });
      expect(execResult.isError).toBeFalsy();
      const execData = JSON.parse((execResult.content as Array<{ text: string }>)[0].text);
      expect(execData.jobId).toBeDefined();
      expect(execData.status).toBe('queued');

      // 6. Check job status
      const statusResult = await client.callTool({
        name: 'get-job-status',
        arguments: { jobId: execData.jobId },
      });
      expect(statusResult.isError).toBeFalsy();
      const statusData = JSON.parse((statusResult.content as Array<{ text: string }>)[0].text);
      expect(statusData.status).toBe('pending');

      // 7. Read nomad://models resource — should show our model
      const resource = await client.readResource({ uri: 'nomad://models' });
      const resourceData = JSON.parse((resource.contents as Array<{ text: string }>)[0].text);
      expect(resourceData.totalCount).toBe(1);
      expect(resourceData.models[0].name).toBe('Highway 3 Fire — Boreal Spruce');
    });
  });
});
