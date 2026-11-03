/**
 * MCP Batch Tools — Unit Tests (#167 phase 4)
 *
 * clone-model, batch-execute and compare-models surface functionality NOMAD
 * already has — they compose `/models/:id/config`, `/models/:id/execute` and
 * `/models/:id/results`. Nothing here reaches for a capability that does not
 * exist; that is #508.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerModelTools } from '../../tools/models.js';
import { registerExecutionTools } from '../../tools/execution.js';
import { registerBatchTools } from '../../tools/batch.js';
import {
  FireModel,
  createFireModelId,
  ModelStatus,
  ModelResult,
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

let jobSeq = 0;
vi.mock('../../../infrastructure/services/JobQueue.js', () => ({
  getJobQueue: () => ({
    getJob: vi.fn(async (jobId: string) => {
      const job = mockJobs.get(jobId);
      if (!job) return Result.fail(new NotFoundError('Job', jobId));
      return Result.ok(job);
    }),
    enqueue: vi.fn(async (modelId: string) => {
      const jobId = createJobId(`test-job-${++jobSeq}`);
      const job = new Job({
        id: jobId,
        modelId: createFireModelId(modelId),
        status: JobStatus.Pending,
      });
      mockJobs.set(jobId, job);
      return Result.ok(job);
    }),
    updateStatus: vi.fn(async () => Result.ok(undefined)),
    complete: vi.fn(async () => Result.ok(undefined)),
    fail: vi.fn(async () => Result.ok(undefined)),
  }),
}));

function payload(result: unknown): Record<string, unknown> {
  const content = (result as { content: Array<{ text: string }> }).content;
  return JSON.parse(content[0].text) as Record<string, unknown>;
}

describe('MCP Batch Tools (#167 phase 4)', () => {
  let client: Client;
  let server: McpServer;

  beforeAll(async () => {
    server = new McpServer(
      { name: 'test-server', version: '1.0.0' },
      { capabilities: { logging: {} } }
    );
    registerModelTools(server);
    registerExecutionTools(server);
    registerBatchTools(server);

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

  /** A model configured far enough that execute-model accepts it. */
  async function createConfiguredModel(name = 'Batch Test'): Promise<string> {
    const created = await client.callTool({
      name: 'create-model',
      arguments: { name },
    });
    const modelId = payload(created).modelId as string;

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
        timezone: 'America/Edmonton',
      },
    });

    return modelId;
  }

  // ─── clone-model ─────────────────────────────────────────────

  it('clone-model produces a new draft carrying the source configuration', async () => {
    const sourceId = await createConfiguredModel('Original');
    const sourceConfigBefore = JSON.stringify(mockConfigs.get(sourceId));

    const result = await client.callTool({
      name: 'clone-model',
      arguments: { modelId: sourceId, name: 'Cloned run' },
    });

    expect(result.isError).toBeFalsy();
    const body = payload(result);

    // A clone is a NEW model, not a renamed source.
    expect(body.modelId).toBeTypeOf('string');
    expect(body.modelId).not.toBe(sourceId);
    expect(body.sourceModelId).toBe(sourceId);
    expect(body.name).toBe('Cloned run');
    expect(body.status).toBe(ModelStatus.Draft);

    // The configuration travelled.
    expect(mockConfigs.get(body.modelId as string)).toEqual(
      mockConfigs.get(sourceId)
    );

    // And the source is untouched — a clone that mutates its source is the
    // failure this assertion exists to catch.
    expect(JSON.stringify(mockConfigs.get(sourceId))).toBe(sourceConfigBefore);
    expect(mockModels.get(sourceId)?.name).toBe('Original');
  });

  it('clone-model reports MODEL_NOT_FOUND for an unknown source', async () => {
    const result = await client.callTool({
      name: 'clone-model',
      arguments: { modelId: 'no-such-model' },
    });

    expect(result.isError).toBe(true);
    expect(payload(result).code).toBe('MODEL_NOT_FOUND');
  });

  // ─── batch-execute ───────────────────────────────────────────

  it('batch-execute returns one job per submitted model', async () => {
    const first = await createConfiguredModel('First');
    const second = await createConfiguredModel('Second');

    const result = await client.callTool({
      name: 'batch-execute',
      arguments: { modelIds: [first, second] },
    });

    expect(result.isError).toBeFalsy();
    const body = payload(result);
    expect(body.submitted).toBe(2);
    expect(body.failed).toBe(0);

    const rows = body.results as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.modelId)).toEqual([first, second]);
    // Distinct jobs, every one of them real.
    const jobIds = rows.map(r => r.jobId as string);
    expect(new Set(jobIds).size).toBe(2);
    for (const jobId of jobIds) {
      expect(mockJobs.has(jobId)).toBe(true);
    }
  });

  it('batch-execute reports a per-model failure WITHOUT failing the batch', async () => {
    const good = await createConfiguredModel('Configured');

    const result = await client.callTool({
      name: 'batch-execute',
      arguments: { modelIds: [good, 'no-such-model'] },
    });

    // One bad id must not take the batch down, and must not pass silently.
    expect(result.isError).toBeFalsy();
    const body = payload(result);
    expect(body.submitted).toBe(1);
    expect(body.failed).toBe(1);

    const rows = body.results as Array<Record<string, unknown>>;
    const bad = rows.find(r => r.modelId === 'no-such-model');
    expect(bad?.error).toBe('MODEL_NOT_FOUND');
    expect(bad?.jobId).toBeUndefined();

    const ok = rows.find(r => r.modelId === good);
    expect(ok?.jobId).toBeTypeOf('string');
    expect(ok?.error).toBeUndefined();
  });

  // ─── compare-models ──────────────────────────────────────────

  it('compare-models returns one row per requested model', async () => {
    const first = await createConfiguredModel('Alpha');
    const second = await createConfiguredModel('Beta');

    const result = await client.callTool({
      name: 'compare-models',
      arguments: { modelIds: [first, second] },
    });

    expect(result.isError).toBeFalsy();
    const rows = payload(result).models as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.modelId)).toEqual([first, second]);
    expect(rows.map(r => r.name)).toEqual(['Alpha', 'Beta']);
    for (const row of rows) {
      expect(row.status).toBe(ModelStatus.Draft);
      expect(row.resultCount).toBe(0);
    }
  });

  it('compare-models refuses a single model rather than returning a one-row comparison', async () => {
    const only = await createConfiguredModel('Lonely');

    const result = await client.callTool({
      name: 'compare-models',
      arguments: { modelIds: [only] },
    });

    expect(result.isError).toBe(true);
    expect(payload(result).code).toBe('INVALID_PARAMETER');
  });

  it('compare-models names a missing model instead of dropping it from the comparison', async () => {
    const present = await createConfiguredModel('Present');

    const result = await client.callTool({
      name: 'compare-models',
      arguments: { modelIds: [present, 'no-such-model'] },
    });

    expect(result.isError).toBeFalsy();
    const rows = payload(result).models as Array<Record<string, unknown>>;
    // Silently returning one row would be a lie about what was compared.
    expect(rows).toHaveLength(2);
    const missing = rows.find(r => r.modelId === 'no-such-model');
    expect(missing?.error).toBe('MODEL_NOT_FOUND');
  });
});
