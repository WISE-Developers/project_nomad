/**
 * #545 — every field `create-model` DECLARES must be observable after creation.
 *
 * This is deliberately not an assertion about `description`. A test that named that
 * one field would be a second copy of the schema, and would say nothing about the
 * next field someone declares and then drops. The guard DERIVES its cases from the
 * tool's own advertised input schema: for each declared input, set it to a probe
 * value, create the model, and require the probe to be visible in what the server
 * then reports back. A field the server accepts and cannot show again is a silent
 * default — the client was told it could set something, and nothing says it did not
 * take effect.
 *
 * `description` fails this today: it is declared with `.describe('Optional
 * description of the model scenario')`, the handler destructures only `name`, and
 * neither `FireModel` nor the models table has anywhere to put it.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerModelTools } from '../../tools/models.js';
import { FireModel, ModelStatus } from '../../../domain/entities/index.js';

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

/** Text content of a tool result, concatenated. */
function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n');
}

describe('#545 — create-model declares nothing it cannot show back', () => {
  let client: Client;
  let server: McpServer;
  let declaredInputs: string[];

  beforeAll(async () => {
    server = new McpServer(
      { name: 'test-server', version: '1.0.0' },
      { capabilities: { logging: {} } },
    );
    registerModelTools(server);

    client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const tools = await client.listTools();
    const createModel = tools.tools.find((t) => t.name === 'create-model');
    expect(createModel, 'create-model must be registered').toBeDefined();

    const schema = createModel!.inputSchema as { properties?: Record<string, unknown> };
    declaredInputs = Object.keys(schema.properties ?? {});
  });

  beforeEach(() => {
    mockModels.clear();
    mockConfigs.clear();
  });

  it('advertises at least one input — the control for the loop below', () => {
    // Without this, a schema that declared NOTHING would pass the derived test
    // vacuously: zero cases, zero failures. The loop proves a property of the
    // declared fields, so an empty declaration has to be a failure, not a pass.
    expect(declaredInputs.length).toBeGreaterThan(0);
    expect(declaredInputs).toContain('name');
  });

  it.each([true])('every declared input is observable after create (%s)', async () => {
    const unobservable: string[] = [];

    for (const field of declaredInputs) {
      mockModels.clear();
      const probe = `probe-${field}-7f3a91`;

      const created = await client.callTool({
        name: 'create-model',
        // `name` is required, so it is always sent; the field under test is set to
        // the probe, which for `name` is the same thing.
        arguments: { name: field === 'name' ? probe : 'Control Model', [field]: probe },
      });

      const listed = await client.callTool({ name: 'list-models', arguments: {} });
      const visible = `${textOf(created)}\n${textOf(listed)}`;

      if (!visible.includes(probe)) unobservable.push(field);
    }

    expect(
      unobservable,
      `create-model declares ${unobservable.join(', ')} but never shows ${
        unobservable.length === 1 ? 'it' : 'them'
      } back — the client is told it set something that went nowhere`,
    ).toEqual([]);
  });

  it('still creates a model for a client that sends the removed description field', async () => {
    // Removing a declared input is only safe if an already-deployed client sending it
    // is not broken by the removal. This records which of the two actually happens
    // rather than assuming the permissive one.
    const result = await client.callTool({
      name: 'create-model',
      arguments: { name: 'Legacy Client Model', description: 'sent by an older client' },
    });

    expect(result.isError ?? false, textOf(result)).toBe(false);
    expect(textOf(result)).toContain('Legacy Client Model');
    expect(mockModels.size).toBe(1);
  });
});
