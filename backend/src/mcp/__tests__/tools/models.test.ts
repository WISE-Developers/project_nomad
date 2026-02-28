/**
 * MCP Model Configuration Tools — Unit Tests
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerModelTools } from '../../tools/models.js';
import {
  FireModel,
  ModelStatus,
} from '../../../domain/entities/index.js';

// ─── Mock the repository ────────────────────────────────────────
const mockModels = new Map<string, FireModel>();
const mockConfigs = new Map<string, Record<string, unknown>>();

vi.mock('../../../infrastructure/database/index.js', () => ({
  getModelRepository: () => ({
    save: vi.fn(async (model: FireModel) => {
      mockModels.set(model.id, model);
      return model;
    }),
    findById: vi.fn(async (id: string) => mockModels.get(id) ?? null),
    find: vi.fn(async (_filter: unknown, options?: { limit?: number }) => ({
      models: Array.from(mockModels.values()).slice(0, options?.limit ?? 20),
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
  }),
}));

describe('MCP Model Tools', () => {
  let client: Client;
  let server: McpServer;

  beforeAll(async () => {
    server = new McpServer(
      { name: 'test-server', version: '1.0.0' },
      { capabilities: { logging: {} } }
    );
    registerModelTools(server);

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
  });

  // ─── create-model ────────────────────────────────────────────
  describe('create-model', () => {
    it('creates a model and returns modelId', async () => {
      const result = await client.callTool({
        name: 'create-model',
        arguments: { name: 'Test Fire' },
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.modelId).toBeDefined();
      expect(data.name).toBe('Test Fire');
      expect(data.engine).toBe('firestarr');
      expect(data.status).toBe('draft');
    });

    it('message mentions set-ignition, set-weather, set-simulation-time (not set-fuel-type)', async () => {
      const result = await client.callTool({
        name: 'create-model',
        arguments: { name: 'Config Test' },
      });

      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.message).toContain('set-ignition');
      expect(data.message).toContain('set-weather');
      expect(data.message).toContain('set-simulation-time');
      expect(data.message).not.toContain('set-fuel-type');
    });
  });

  // ─── list-models ─────────────────────────────────────────────
  describe('list-models', () => {
    it('returns empty list when no models exist', async () => {
      const result = await client.callTool({
        name: 'list-models',
        arguments: {},
      });

      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.models).toEqual([]);
      expect(data.totalCount).toBe(0);
    });

    it('returns models with configuredSections (not a "configured" boolean)', async () => {
      await client.callTool({
        name: 'create-model',
        arguments: { name: 'Model A' },
      });

      const result = await client.callTool({
        name: 'list-models',
        arguments: {},
      });

      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.totalCount).toBe(1);
      expect(data.models[0]).toHaveProperty('configuredSections');
      expect(Array.isArray(data.models[0].configuredSections)).toBe(true);
      expect(data.models[0]).not.toHaveProperty('configured');
    });
  });

  // ─── set-ignition ────────────────────────────────────────────
  describe('set-ignition', () => {
    it('sets a point ignition on a model', async () => {
      const createResult = await client.callTool({
        name: 'create-model',
        arguments: { name: 'Ignition Test' },
      });
      const { modelId } = JSON.parse((createResult.content as Array<{ text: string }>)[0].text);

      const result = await client.callTool({
        name: 'set-ignition',
        arguments: {
          modelId,
          type: 'point',
          coordinates: [-114.3, 62.5],
        },
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.ignition.type).toBe('point');
      expect(data.ignition.coordinates).toEqual([-114.3, 62.5]);

      // Config should be persisted
      const config = mockConfigs.get(modelId);
      expect(config?.ignition).toBeDefined();
    });

    it('sets a polygon ignition on a model', async () => {
      const createResult = await client.callTool({
        name: 'create-model',
        arguments: { name: 'Polygon Test' },
      });
      const { modelId } = JSON.parse((createResult.content as Array<{ text: string }>)[0].text);

      // A valid closed ring with 4+ points
      const ring = [
        [-114.3, 62.5],
        [-114.2, 62.5],
        [-114.2, 62.4],
        [-114.3, 62.4],
        [-114.3, 62.5],
      ];

      const result = await client.callTool({
        name: 'set-ignition',
        arguments: {
          modelId,
          type: 'polygon',
          coordinates: ring,
        },
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.ignition.type).toBe('polygon');
    });

    it('rejects invalid polygon (not closed)', async () => {
      const createResult = await client.callTool({
        name: 'create-model',
        arguments: { name: 'Bad Polygon' },
      });
      const { modelId } = JSON.parse((createResult.content as Array<{ text: string }>)[0].text);

      // Open ring (first != last)
      const openRing = [
        [-114.3, 62.5],
        [-114.2, 62.5],
        [-114.2, 62.4],
        [-114.3, 62.4],
      ];

      const result = await client.callTool({
        name: 'set-ignition',
        arguments: {
          modelId,
          type: 'polygon',
          coordinates: openRing,
        },
      });

      expect(result.isError).toBe(true);
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.code).toBe('INVALID_PARAMETER');
    });

    it('rejects out-of-range point coordinates', async () => {
      const createResult = await client.callTool({
        name: 'create-model',
        arguments: { name: 'Bad Point' },
      });
      const { modelId } = JSON.parse((createResult.content as Array<{ text: string }>)[0].text);

      const result = await client.callTool({
        name: 'set-ignition',
        arguments: {
          modelId,
          type: 'point',
          coordinates: [200, 62.5], // lon out of range
        },
      });

      expect(result.isError).toBe(true);
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.code).toBe('INVALID_COORDINATES');
    });

    it('returns error for non-existent model', async () => {
      const result = await client.callTool({
        name: 'set-ignition',
        arguments: {
          modelId: 'nonexistent',
          type: 'point',
          coordinates: [-114.3, 62.5],
        },
      });

      expect(result.isError).toBe(true);
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.code).toBe('MODEL_NOT_FOUND');
    });
  });

  // ─── set-weather ─────────────────────────────────────────────
  describe('set-weather', () => {
    it('sets weather with firestarr_csv source', async () => {
      const createResult = await client.callTool({
        name: 'create-model',
        arguments: { name: 'Weather Test CSV' },
      });
      const { modelId } = JSON.parse((createResult.content as Array<{ text: string }>)[0].text);

      const result = await client.callTool({
        name: 'set-weather',
        arguments: {
          modelId,
          source: 'firestarr_csv',
          firestarrCsvContent: 'datetime,temp,rh,ws,wd,precip\n2026-06-15T14:00:00Z,30,20,25,270,0',
        },
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.weather.source).toBe('firestarr_csv');

      const config = mockConfigs.get(modelId);
      expect((config?.weather as Record<string, unknown>)?.source).toBe('firestarr_csv');
    });

    it('sets weather with raw_weather source and starting codes', async () => {
      const createResult = await client.callTool({
        name: 'create-model',
        arguments: { name: 'Weather Test Raw' },
      });
      const { modelId } = JSON.parse((createResult.content as Array<{ text: string }>)[0].text);

      const result = await client.callTool({
        name: 'set-weather',
        arguments: {
          modelId,
          source: 'raw_weather',
          rawWeatherContent: 'datetime,temp,rh,ws,wd,precip\n2026-06-15T14:00:00Z,30,20,25,270,0',
          startingCodes: { ffmc: 87, dmc: 45, dc: 300 },
        },
      });

      expect(result.isError).toBeFalsy();
      const config = mockConfigs.get(modelId);
      const weather = config?.weather as Record<string, unknown>;
      expect(weather?.source).toBe('raw_weather');
      expect(weather?.startingCodes).toEqual({ ffmc: 87, dmc: 45, dc: 300 });
    });

    it('rejects firestarr_csv without CSV content', async () => {
      const createResult = await client.callTool({
        name: 'create-model',
        arguments: { name: 'Bad Weather' },
      });
      const { modelId } = JSON.parse((createResult.content as Array<{ text: string }>)[0].text);

      const result = await client.callTool({
        name: 'set-weather',
        arguments: {
          modelId,
          source: 'firestarr_csv',
          // missing firestarrCsvContent
        },
      });

      expect(result.isError).toBe(true);
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.code).toBe('INVALID_PARAMETER');
    });

    it('rejects raw_weather without starting codes', async () => {
      const createResult = await client.callTool({
        name: 'create-model',
        arguments: { name: 'Bad Weather No FWI' },
      });
      const { modelId } = JSON.parse((createResult.content as Array<{ text: string }>)[0].text);

      const result = await client.callTool({
        name: 'set-weather',
        arguments: {
          modelId,
          source: 'raw_weather',
          rawWeatherContent: 'some,csv,content',
          // missing startingCodes
        },
      });

      expect(result.isError).toBe(true);
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.code).toBe('WEATHER_MISSING_FWI');
    });

    it('rejects raw_weather without rawWeatherContent', async () => {
      const createResult = await client.callTool({
        name: 'create-model',
        arguments: { name: 'Bad Weather No Content' },
      });
      const { modelId } = JSON.parse((createResult.content as Array<{ text: string }>)[0].text);

      const result = await client.callTool({
        name: 'set-weather',
        arguments: {
          modelId,
          source: 'raw_weather',
          // missing rawWeatherContent
          startingCodes: { ffmc: 87, dmc: 45, dc: 300 },
        },
      });

      expect(result.isError).toBe(true);
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.code).toBe('INVALID_PARAMETER');
    });
  });

  // ─── set-simulation-time ─────────────────────────────────────
  describe('set-simulation-time', () => {
    it('sets simulation time with startTime and endTime', async () => {
      const createResult = await client.callTool({
        name: 'create-model',
        arguments: { name: 'Time Test' },
      });
      const { modelId } = JSON.parse((createResult.content as Array<{ text: string }>)[0].text);

      const result = await client.callTool({
        name: 'set-simulation-time',
        arguments: {
          modelId,
          startTime: '2026-06-15T14:00:00Z',
          endTime: '2026-06-15T20:00:00Z',
        },
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.timeRange.start).toBe('2026-06-15T14:00:00Z');
      expect(data.timeRange.end).toBe('2026-06-15T20:00:00Z');

      const config = mockConfigs.get(modelId);
      expect(config?.timeRange).toEqual({ start: '2026-06-15T14:00:00Z', end: '2026-06-15T20:00:00Z' });
    });

    it('rejects invalid startTime', async () => {
      const createResult = await client.callTool({
        name: 'create-model',
        arguments: { name: 'Bad Time Test' },
      });
      const { modelId } = JSON.parse((createResult.content as Array<{ text: string }>)[0].text);

      const result = await client.callTool({
        name: 'set-simulation-time',
        arguments: {
          modelId,
          startTime: 'not-a-date',
          endTime: '2026-06-15T20:00:00Z',
        },
      });

      expect(result.isError).toBe(true);
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.code).toBe('INVALID_PARAMETER');
      expect(data.field).toBe('startTime');
    });

    it('rejects endTime before startTime', async () => {
      const createResult = await client.callTool({
        name: 'create-model',
        arguments: { name: 'Reverse Time Test' },
      });
      const { modelId } = JSON.parse((createResult.content as Array<{ text: string }>)[0].text);

      const result = await client.callTool({
        name: 'set-simulation-time',
        arguments: {
          modelId,
          startTime: '2026-06-15T20:00:00Z',
          endTime: '2026-06-15T14:00:00Z', // before start
        },
      });

      expect(result.isError).toBe(true);
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.code).toBe('INVALID_PARAMETER');
      expect(data.field).toBe('endTime');
    });
  });
});
