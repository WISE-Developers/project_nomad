/**
 * MCP identity: who owns what MCP creates.
 *
 * Everything MCP creates is attributed to the configured identity, in the same terms
 * the HTTP path uses, so MCP-created records are owned like any other. Attribution is
 * what makes that output usable by the rest of the system — ownership filtering,
 * deletion and audit all key on it.
 *
 * THE IDENTITY MUST RESOLVE TO A REAL ACCOUNT. A configured identity matching no
 * account would attribute records to something that does not exist, and such a record
 * reads as correctly owned on inspection, so resolution happens at startup and a
 * failure to resolve stops the process.
 *
 * WHAT VERIFICATION CAN MEAN, PER MODE. Only `oauth` has a local account store
 * (`auth_user`, which Better Auth manages and creates itself, so it is absent in the
 * other modes). `simple` takes a name from a header, `none` has no identity concept,
 * and ACN defers to an upstream agency this process cannot interrogate at startup. In
 * those three there is nothing to resolve against, so the identity is recorded as
 * UNVERIFIED rather than checked against a store that is not there — an unprovable
 * claim is labelled, never treated as proven.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { FireModel, ModelStatus, EngineType } from '../../domain/entities/index.js';

const mockModels = new Map<string, FireModel>();
/** Every model handed to the repository, in order, so ownership can be inspected. */
const saved: FireModel[] = [];

vi.mock('../../infrastructure/database/index.js', () => ({
  getResultRepository: () => ({
    save: vi.fn(async () => {}),
    findByModelId: vi.fn(async () => []),
  }),
  getModelRepository: () => ({
    save: vi.fn(async (model: FireModel) => {
      saved.push(model);
      mockModels.set(model.id, model);
      return model;
    }),
    findById: vi.fn(async (id: string) => mockModels.get(id) ?? null),
    find: vi.fn(async () => ({ models: [], totalCount: 0, hasMore: false })),
    updateStatus: vi.fn(async (id: string, status: ModelStatus) => {
      const model = mockModels.get(id);
      if (!model) throw new Error('Not found');
      const updated = model.withStatus(status);
      mockModels.set(id, updated);
      return updated;
    }),
    getConfigJson: vi.fn(async () => ({ scenario: 'x' })),
    saveConfigJson: vi.fn(async () => {}),
    getResults: vi.fn(async () => []),
  }),
}));

vi.mock('../../infrastructure/firestarr/FireSTARREngine.js', () => ({
  getFireSTARREngine: () => ({
    execute: vi.fn(async () => ({ success: true })),
    validateConfig: vi.fn(() => ({ valid: true, errors: [] })),
  }),
}));

const { resolveMcpIdentity } = await import('../identity.js');
const { registerAllTools } = await import('../tools/index.js');

const IDENTITY = 'franco@example.org';

/** A store that knows exactly one account, so both answers are reachable. */
const storeWith = (emails: string[]) => ({
  hasAccount: vi.fn(async (email: string) => emails.includes(email)),
});

beforeEach(() => {
  mockModels.clear();
  saved.length = 0;
});

// ─── Condition 4: resolution, and failing closed when it fails ───

describe('resolveMcpIdentity — oauth mode resolves against the account store', () => {
  it('returns the identity as VERIFIED when the account exists', async () => {
    const store = storeWith([IDENTITY]);
    await expect(resolveMcpIdentity(IDENTITY, 'oauth', store)).resolves.toEqual({
      userId: IDENTITY,
      verified: true,
    });
    expect(store.hasAccount).toHaveBeenCalledWith(IDENTITY);
  });

  it('THROWS when the account does not exist, rather than recording an orphan', async () => {
    await expect(
      resolveMcpIdentity(IDENTITY, 'oauth', storeWith(['someone.else@example.org'])),
    ).rejects.toThrow(/NOMAD_MCP_IDENTITY .*does not match any account/);
  });

  // These two next assertions were both `/could not be verified/` first, and mutation
  // showed that could not tell them apart: with the `!store` guard removed, calling
  // `hasAccount` on `undefined` throws a TypeError which the catch block converts into
  // the SAME message, so the mutation survived. The guard was not dead — the matcher
  // was blunt. Each now matches only the text its own branch produces, which is the
  // whole value of having two branches: "this name is wrong" and "I could not find
  // out" call for different fixes from whoever reads the error.
  it('THROWS when the store cannot be consulted — an unanswered check is not a pass', async () => {
    const broken = {
      hasAccount: vi.fn(async () => {
        throw new Error('relation "auth_user" does not exist');
      }),
    };
    await expect(resolveMcpIdentity(IDENTITY, 'oauth', broken)).rejects.toThrow(
      /the account store could not be consulted \(relation "auth_user" does not exist\)/,
    );
  });

  it('THROWS when no store is supplied at all in oauth mode', async () => {
    await expect(resolveMcpIdentity(IDENTITY, 'oauth')).rejects.toThrow(
      /no account store was available in oauth mode/,
    );
  });
});

describe('resolveMcpIdentity — the modes with no account store to resolve against', () => {
  // These are the honest cases. `simple` reads a name from a header, `none` has no
  // identity concept, ACN defers upstream: there is no local store, so the identity
  // is LABELLED unverified instead of being called checked.
  it.each(['simple', 'none', 'acn'] as const)(
    'accepts the identity in %s mode but marks it UNVERIFIED',
    async (mode) => {
      await expect(resolveMcpIdentity(IDENTITY, mode)).resolves.toEqual({
        userId: IDENTITY,
        verified: false,
      });
    },
  );

  it('never consults a store in those modes, so a present store is not silently trusted', async () => {
    const store = storeWith([]);
    await expect(resolveMcpIdentity(IDENTITY, 'simple', store)).resolves.toEqual({
      userId: IDENTITY,
      verified: false,
    });
    expect(store.hasAccount).not.toHaveBeenCalled();
  });

  it('CONTROL: the same store IS consulted in oauth mode, so the spy above can fire', async () => {
    const store = storeWith([IDENTITY]);
    await resolveMcpIdentity(IDENTITY, 'oauth', store);
    expect(store.hasAccount).toHaveBeenCalled();
  });
});

// ─── Condition 7: everything MCP creates carries that identity ───

/** Wires an in-memory MCP client to a server whose tools carry `userId`. */
async function connectTools(userId?: string): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '1.0.0' }, { capabilities: {} });
  registerAllTools(server, userId ? { userId } : undefined);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe('every model MCP creates carries the configured identity', () => {
  it('create-model stores the identity as userId', async () => {
    const client = await connectTools(IDENTITY);
    await client.callTool({ name: 'create-model', arguments: { name: 'Highway 3' } });

    expect(saved).toHaveLength(1);
    expect(saved[0].userId).toBe(IDENTITY);
  });

  it('clone-model stores it too — there are two creation sites, not one', async () => {
    // mcp/tools/models.ts:89 and mcp/tools/batch.ts:92 each construct a FireModel. A
    // fix applied to one is not applied to the other, so both are named and both
    // checked. The clone is attributed to the MCP identity rather than inheriting the
    // source's owner: the MCP caller is who made this new record.
    const client = await connectTools(IDENTITY);
    const created = await client.callTool({
      name: 'create-model',
      arguments: { name: 'Source' },
    });
    const { modelId } = JSON.parse((created.content as { text: string }[])[0].text);

    saved.length = 0;
    await client.callTool({ name: 'clone-model', arguments: { modelId } });

    expect(saved.length).toBeGreaterThan(0);
    for (const model of saved) {
      expect(model.userId).toBe(IDENTITY);
    }
  });

  it('CONTROL: with no identity configured the models come back unowned', async () => {
    // Without this the assertions above could be passing on a field that is set
    // somewhere else entirely, or on a mock that fabricates it. This shows the test
    // can observe BOTH answers through the same path.
    const client = await connectTools(undefined);
    await client.callTool({ name: 'create-model', arguments: { name: 'Orphan' } });

    expect(saved).toHaveLength(1);
    expect(saved[0].userId).toBeUndefined();
  });

  it('CONTROL: the entity really does carry userId, so undefined above means absent', () => {
    const probe = new FireModel({
      id: saved[0]?.id ?? ('probe' as never),
      name: 'probe',
      engineType: EngineType.FireSTARR,
      userId: IDENTITY,
    });
    expect(probe.userId).toBe(IDENTITY);
  });
});
