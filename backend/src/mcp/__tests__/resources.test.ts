/**
 * MCP Resources — Unit Tests
 *
 * Tests knowledge and dynamic resources for correct structure and content.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerAllResources } from '../resources/index.js';
import {
  FireModel,
  ModelStatus,
  Job,
  createJobId,
  createFireModelId,
  JobStatus,
  ModelResult,
  createModelResultId,
  OutputType,
  OutputFormat,
} from '../../domain/entities/index.js';
import { Result } from '../../application/common/index.js';
import { NotFoundError } from '../../domain/errors/index.js';

// ─── Mock data stores ───────────────────────────────────────────
const mockModels = new Map<string, FireModel>();
const mockJobs = new Map<string, Job>();
const mockResults = new Map<string, ModelResult[]>();

vi.mock('../../infrastructure/database/index.js', () => ({
  getModelRepository: () => ({
    findById: vi.fn(async (id: string) => mockModels.get(id) ?? null),
    find: vi.fn(async (_filter: unknown, options?: { limit?: number }) => ({
      models: Array.from(mockModels.values()).slice(0, options?.limit ?? 100),
      totalCount: mockModels.size,
      hasMore: false,
    })),
  }),
  getResultRepository: () => ({
    findByModelId: vi.fn(async (modelId: string) => mockResults.get(modelId) ?? []),
  }),
}));

vi.mock('../../infrastructure/services/JobQueue.js', () => ({
  getJobQueue: () => ({
    getJob: vi.fn(async (jobId: string) => {
      const job = mockJobs.get(jobId);
      if (!job) return Result.fail(new NotFoundError('Job', jobId));
      return Result.ok(job);
    }),
  }),
}));

describe('MCP Resources', () => {
  let client: Client;
  let server: McpServer;

  beforeAll(async () => {
    server = new McpServer(
      { name: 'nomad-test', version: '1.0.0' },
      { capabilities: { logging: {} } }
    );
    registerAllResources(server);

    client = new Client({ name: 'test-client', version: '1.0.0' });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
  });

  beforeEach(() => {
    mockModels.clear();
    mockJobs.clear();
    mockResults.clear();
  });

  // ─── Knowledge: fuel-types ───────────────────────────────────
  describe('nomad://knowledge/fuel-types', () => {
    it('returns valid JSON', async () => {
      const result = await client.readResource({ uri: 'nomad://knowledge/fuel-types' });
      const text = (result.contents as Array<{ text: string }>)[0].text;
      expect(() => JSON.parse(text)).not.toThrow();
    });

    it('catalog has 20 fuel types', async () => {
      const result = await client.readResource({ uri: 'nomad://knowledge/fuel-types' });
      const data = JSON.parse((result.contents as Array<{ text: string }>)[0].text);
      expect(data.fuelTypeCount).toBe(20);
      expect(data.fuelTypes).toHaveLength(20);
    });

    it('includes all FBP fuel type groups', async () => {
      const result = await client.readResource({ uri: 'nomad://knowledge/fuel-types' });
      const data = JSON.parse((result.contents as Array<{ text: string }>)[0].text);
      const groups = new Set(data.fuelTypes.map((ft: { group: string }) => ft.group));
      expect(groups).toContain('Coniferous');
      expect(groups).toContain('Deciduous');
      expect(groups).toContain('Mixedwood');
      expect(groups).toContain('Slash');
      expect(groups).toContain('Open');
      expect(groups).toContain('Non-fuel');
    });

    it('includes notes about special fuel type parameters', async () => {
      const result = await client.readResource({ uri: 'nomad://knowledge/fuel-types' });
      const data = JSON.parse((result.contents as Array<{ text: string }>)[0].text);
      expect(Array.isArray(data.notes)).toBe(true);
      expect(data.notes.length).toBeGreaterThan(0);
    });

    it('each fuel type has required fields', async () => {
      const result = await client.readResource({ uri: 'nomad://knowledge/fuel-types' });
      const data = JSON.parse((result.contents as Array<{ text: string }>)[0].text);
      for (const ft of data.fuelTypes) {
        expect(ft).toHaveProperty('code');
        expect(ft).toHaveProperty('name');
        expect(ft).toHaveProperty('group');
        expect(ft).toHaveProperty('description');
      }
    });
  });

  // ─── Knowledge: fwi-system ───────────────────────────────────
  describe('nomad://knowledge/fwi-system', () => {
    it('returns valid JSON', async () => {
      const result = await client.readResource({ uri: 'nomad://knowledge/fwi-system' });
      const text = (result.contents as Array<{ text: string }>)[0].text;
      expect(() => JSON.parse(text)).not.toThrow();
    });

    it('contains all 6 FWI components', async () => {
      const result = await client.readResource({ uri: 'nomad://knowledge/fwi-system' });
      const data = JSON.parse((result.contents as Array<{ text: string }>)[0].text);
      expect(data.components).toHaveLength(6);
      const codes = data.components.map((c: { code: string }) => c.code);
      expect(codes).toContain('FFMC');
      expect(codes).toContain('DMC');
      expect(codes).toContain('DC');
      expect(codes).toContain('ISI');
      expect(codes).toContain('BUI');
      expect(codes).toContain('FWI');
    });

    it('includes operational thresholds with 5 danger classes', async () => {
      const result = await client.readResource({ uri: 'nomad://knowledge/fwi-system' });
      const data = JSON.parse((result.contents as Array<{ text: string }>)[0].text);
      expect(data.operationalThresholds).toHaveLength(5);
      const classes = data.operationalThresholds.map((t: { class: string }) => t.class);
      expect(classes).toContain('Low');
      expect(classes).toContain('Moderate');
      expect(classes).toContain('High');
      expect(classes).toContain('Very High');
      expect(classes).toContain('Extreme');
    });

    it('includes calculation order', async () => {
      const result = await client.readResource({ uri: 'nomad://knowledge/fwi-system' });
      const data = JSON.parse((result.contents as Array<{ text: string }>)[0].text);
      expect(Array.isArray(data.calculationOrder)).toBe(true);
      expect(data.calculationOrder).toHaveLength(6);
    });
  });

  // ─── Knowledge: model-parameters ─────────────────────────────
  describe('nomad://knowledge/model-parameters', () => {
    it('returns valid JSON', async () => {
      const result = await client.readResource({ uri: 'nomad://knowledge/model-parameters' });
      const text = (result.contents as Array<{ text: string }>)[0].text;
      expect(() => JSON.parse(text)).not.toThrow();
    });

    it('contains ignition parameter category', async () => {
      const result = await client.readResource({ uri: 'nomad://knowledge/model-parameters' });
      const data = JSON.parse((result.contents as Array<{ text: string }>)[0].text);
      expect(data.parameters).toHaveProperty('ignition');
      expect(data.parameters.ignition).toHaveProperty('types');
    });

    it('contains weather parameter category with all 3 sources', async () => {
      const result = await client.readResource({ uri: 'nomad://knowledge/model-parameters' });
      const data = JSON.parse((result.contents as Array<{ text: string }>)[0].text);
      expect(data.parameters).toHaveProperty('weather');
      expect(data.parameters.weather.sources).toHaveProperty('raw_weather');
      expect(data.parameters.weather.sources).toHaveProperty('firestarr_csv');
      expect(data.parameters.weather.sources).toHaveProperty('spotwx');
    });

    it('contains timeRange parameter category', async () => {
      const result = await client.readResource({ uri: 'nomad://knowledge/model-parameters' });
      const data = JSON.parse((result.contents as Array<{ text: string }>)[0].text);
      expect(data.parameters).toHaveProperty('timeRange');
      expect(data.parameters.timeRange.fields).toHaveProperty('startTime');
      expect(data.parameters.timeRange.fields).toHaveProperty('endTime');
      expect(data.parameters.timeRange.fields).toHaveProperty('durationHours');
    });

    it('contains simulationOptions parameter category', async () => {
      const result = await client.readResource({ uri: 'nomad://knowledge/model-parameters' });
      const data = JSON.parse((result.contents as Array<{ text: string }>)[0].text);
      expect(data.parameters).toHaveProperty('simulationOptions');
      expect(data.parameters.simulationOptions.fields).toHaveProperty('scenarios');
    });

    it('lists required parameters for execution', async () => {
      const result = await client.readResource({ uri: 'nomad://knowledge/model-parameters' });
      const data = JSON.parse((result.contents as Array<{ text: string }>)[0].text);
      expect(Array.isArray(data.requiredForExecution)).toBe(true);
      expect(data.requiredForExecution.length).toBeGreaterThan(0);
    });
  });

  // ─── Dynamic: nomad://models ──────────────────────────────────
  describe('nomad://models', () => {
    it('returns empty list when no models exist', async () => {
      const result = await client.readResource({ uri: 'nomad://models' });
      const data = JSON.parse((result.contents as Array<{ text: string }>)[0].text);
      expect(data.models).toEqual([]);
      expect(data.totalCount).toBe(0);
    });

    it('returns models when they exist', async () => {
      const model = new FireModel({
        id: createFireModelId('test-model-1'),
        name: 'Test Fire',
        engineType: 'firestarr' as never,
        status: ModelStatus.Draft,
      });
      mockModels.set(model.id, model);

      const result = await client.readResource({ uri: 'nomad://models' });
      const data = JSON.parse((result.contents as Array<{ text: string }>)[0].text);
      expect(data.totalCount).toBe(1);
      expect(data.models[0].name).toBe('Test Fire');
      expect(data.models[0]).not.toHaveProperty('configured');
    });
  });

  // ─── Dynamic: nomad://models/{modelId} ───────────────────────
  describe('nomad://models/{modelId}', () => {
    it('returns model not found for unknown ID', async () => {
      const result = await client.readResource({ uri: 'nomad://models/nonexistent' });
      const data = JSON.parse((result.contents as Array<{ text: string }>)[0].text);
      expect(data.error).toBe('Model not found');
      expect(data.modelId).toBe('nonexistent');
    });

    it('returns model detail for known ID', async () => {
      const modelId = createFireModelId('detail-test');
      const model = new FireModel({
        id: modelId,
        name: 'Detail Test Fire',
        engineType: 'firestarr' as never,
        status: ModelStatus.Draft,
      });
      mockModels.set(modelId, model);

      const result = await client.readResource({ uri: `nomad://models/${modelId}` });
      const data = JSON.parse((result.contents as Array<{ text: string }>)[0].text);
      expect(data.name).toBe('Detail Test Fire');
      expect(data.id).toBe(modelId);
      expect(data).not.toHaveProperty('configuration');
    });
  });

  // ─── Dynamic: nomad://jobs/{jobId} ───────────────────────────
  describe('nomad://jobs/{jobId}', () => {
    it('returns job not found for unknown ID', async () => {
      const result = await client.readResource({ uri: 'nomad://jobs/nonexistent' });
      const data = JSON.parse((result.contents as Array<{ text: string }>)[0].text);
      expect(data.error).toBe('Job not found');
      expect(data.jobId).toBe('nonexistent');
    });

    it('returns job status for known job', async () => {
      const jobId = createJobId('resource-test-job');
      const job = new Job({
        id: jobId,
        modelId: createFireModelId('some-model'),
        status: JobStatus.Running,
        progress: 42,
      });
      mockJobs.set(jobId, job);

      const result = await client.readResource({ uri: `nomad://jobs/${jobId}` });
      const data = JSON.parse((result.contents as Array<{ text: string }>)[0].text);
      expect(data.id).toBe(jobId);
      expect(data.status).toBe('running');
      expect(data.progress).toBe(42);
      expect(data.createdAt).toBeDefined();
    });
  });

  // ─── Dynamic: nomad://models/{modelId}/results ───────────────
  describe('nomad://models/{modelId}/results', () => {
    it('returns empty results for model with no results', async () => {
      const result = await client.readResource({ uri: 'nomad://models/no-results-model/results' });
      const data = JSON.parse((result.contents as Array<{ text: string }>)[0].text);
      expect(data.resultCount).toBe(0);
      expect(data.results).toEqual([]);
    });

    it('returns result inventory for model with results', async () => {
      const modelId = createFireModelId('results-model');
      const modelResult = new ModelResult({
        id: createModelResultId('result-1'),
        fireModelId: modelId,
        outputType: OutputType.Probability,
        format: OutputFormat.GeoTIFF,
        metadata: { timeOffsetHours: 6 },
      });
      mockResults.set(modelId, [modelResult]);

      const result = await client.readResource({ uri: `nomad://models/${modelId}/results` });
      const data = JSON.parse((result.contents as Array<{ text: string }>)[0].text);
      expect(data.resultCount).toBe(1);
      expect(data.results[0].outputType).toBe('probability');
      expect(data.results[0].format).toBe('geotiff');
      expect(data.results[0].displayName).toBeDefined();
    });
  });
});
