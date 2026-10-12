/**
 * MCP/GUI execution parity — the options MCP actually hands the engine.
 *
 * WHY THIS FILE EXISTS SEPARATELY from execution.test.ts: that suite mocks the
 * engine as `getFireSTARREngine: () => ({ initialize: vi.fn(...) })`, which mints
 * a BRAND NEW spy on every call. So no test in it can assert what was passed —
 * the spy it would assert against is discarded the moment it is used. The suite
 * is not merely missing this assertion; it is structurally incapable of it.
 *
 * That is the distinction this project keeps paying for: "called with anything"
 * and "called correctly" are different facts, and only the first was ever
 * establishable here. A retained spy, hoisted below, is the instrument that makes
 * the second observable.
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
  Job,
  createJobId,
  JobStatus,
} from '../../../domain/entities/index.js';
import { Result } from '../../../application/common/index.js';
import { NotFoundError } from '../../../domain/errors/index.js';

// ─── The retained spy. This is the point of the file. ───────────
const { initializeSpy } = vi.hoisted(() => ({
  // Typed parameters, not `async () => {}`: with a zero-arg signature the spy's
  // call tuple infers as [] and `mock.calls[0][1]` is a COMPILE error — which
  // vitest never sees, because vitest does not typecheck. tsc found this after
  // the suite was green.
  initializeSpy: vi.fn(async (_model: unknown, _options: unknown): Promise<void> => {
    /* no-op */
  }),
}));

const mockModels = new Map<string, FireModel>();
const mockConfigs = new Map<string, Record<string, unknown>>();
const mockJobs = new Map<string, Job>();

vi.mock('../../../infrastructure/database/index.js', () => ({
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

vi.mock('../../../infrastructure/engines/index.js', () => ({
  EngineType: { FireSTARR: 'firestarr' },
  getEngine: () => ({
    initialize: initializeSpy,
    execute: vi.fn(async () => {}),
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
      const jobId = createJobId('parity-job-' + Date.now());
      const job = new Job({
        id: jobId,
        modelId: createFireModelId(modelId),
        status: JobStatus.Pending,
      });
      mockJobs.set(jobId, job);
      return Result.ok(job);
    }),
  }),
}));

// executeAndFinalizeModel runs the model in the background. Stub it: this file is
// about what reaches initialize(), not about the run.
vi.mock('../../../application/services/executeAndFinalizeModel.js', () => ({
  executeAndFinalizeModel: vi.fn(async () => {}),
}));

describe('MCP/GUI execution parity', () => {
  let client: Client;
  let server: McpServer;

  beforeAll(async () => {
    server = new McpServer(
      { name: 'parity-test-server', version: '1.0.0' },
      { capabilities: { logging: {} } },
    );
    registerModelTools(server);
    registerExecutionTools(server);

    client = new Client({ name: 'parity-test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  beforeEach(() => {
    mockModels.clear();
    mockConfigs.clear();
    mockJobs.clear();
    initializeSpy.mockClear();
  });

  async function configureModel(
    ignition: { type: string; coordinates: unknown } = {
      type: 'point',
      coordinates: [-114.3, 62.5],
    },
  ): Promise<string> {
    const createResult = await client.callTool({
      name: 'create-model',
      arguments: { name: 'Parity Test' },
    });
    const { modelId } = JSON.parse((createResult.content as Array<{ text: string }>)[0].text);

    await client.callTool({ name: 'set-ignition', arguments: { modelId, ...ignition } });
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
        timezone: 'America/Edmonton',
      },
    });
    return modelId;
  }

  /** The options object actually handed to engine.initialize. */
  function optionsPassedToEngine(): Record<string, unknown> {
    expect(
      initializeSpy,
      'engine.initialize was never called — this test cannot say anything about ' +
        'its arguments, and a green result here would be vacuous',
    ).toHaveBeenCalled();
    return initializeSpy.mock.calls[0][1] as unknown as Record<string, unknown>;
  }

  describe('the control: the instrument itself', () => {
    it('retains the spy across calls, so arguments are observable at all', async () => {
      await configureModel();
      // Two separate executions must accumulate on the SAME spy. If the engine
      // factory minted a fresh vi.fn() per call — as execution.test.ts does —
      // this would read 1, and every argument assertion in this file would be
      // asserting against a spy that had already been thrown away.
      const a = await configureModel();
      await client.callTool({ name: 'execute-model', arguments: { modelId: a } });
      const b = await configureModel();
      await client.callTool({ name: 'execute-model', arguments: { modelId: b } });

      expect(initializeSpy.mock.calls.length).toBe(2);
    });
  });

  describe('parity with the GUI/HTTP path', () => {
    it('passes simulationCount, as the HTTP route does (scenarios ?? 100)', async () => {
      const modelId = await configureModel();
      await client.callTool({ name: 'execute-model', arguments: { modelId } });

      const options = optionsPassedToEngine();
      expect(options).toHaveProperty('simulationCount');
      expect(typeof options.simulationCount).toBe('number');
    });

    it('passes outputMode, as both HTTP sites do', async () => {
      const modelId = await configureModel();
      await client.callTool({ name: 'execute-model', arguments: { modelId } });

      const options = optionsPassedToEngine();
      expect(options).toHaveProperty('outputMode');
      expect(['probabilistic', 'deterministic']).toContain(options.outputMode);
    });

    it('honours a deterministic run rather than silently defaulting to probabilistic', async () => {
      const modelId = await configureModel();
      await client.callTool({
        name: 'execute-model',
        arguments: { modelId, modelMode: 'deterministic' },
      });

      const options = optionsPassedToEngine();
      expect(options.outputMode).toBe('deterministic');
      // A deterministic run is a single simulation, not 100.
      expect(options.simulationCount).toBe(1);
    });

    it('honours an explicit scenario count', async () => {
      const modelId = await configureModel();
      await client.callTool({
        name: 'execute-model',
        arguments: { modelId, scenarios: 25 },
      });

      expect(optionsPassedToEngine().simulationCount).toBe(25);
    });
  });

  describe('line ignition', () => {
    it('accepts a linestring ignition, which the GUI already emits', async () => {
      const result = await client.callTool({
        name: 'set-ignition',
        arguments: {
          modelId: await (async () => {
            const createResult = await client.callTool({
              name: 'create-model',
              arguments: { name: 'Line Ignition' },
            });
            return JSON.parse((createResult.content as Array<{ text: string }>)[0].text).modelId;
          })(),
          type: 'linestring',
          coordinates: [
            [-114.3, 62.5],
            [-114.2, 62.6],
          ],
        },
      });

      expect(result.isError ?? false).toBe(false);
    });

    it('does NOT silently coerce a line ignition into a polygon', async () => {
      // execution.ts converts ignition with `if (type === 'point') … else → Polygon`.
      // An else over more than two cases is the defect that cost three copies in
      // #432 — a linestring falls into the polygon branch and runs as the wrong
      // geometry, reporting success. That is worse than a refusal.
      const modelId = await configureModel({
        type: 'linestring',
        coordinates: [
          [-114.3, 62.5],
          [-114.2, 62.6],
        ],
      });
      await client.callTool({ name: 'execute-model', arguments: { modelId } });

      const geometry = optionsPassedToEngine().ignitionGeometry as { type?: string };
      expect(geometry.type).not.toBe('Polygon');
    });
  });
});
