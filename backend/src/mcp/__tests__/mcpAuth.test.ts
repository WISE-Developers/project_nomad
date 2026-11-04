/**
 * MCP authentication guard.
 *
 * MCP is an administrative surface whose tools both create and execute work, so it is
 * configured explicitly or not present at all, and the key is checked per request
 * rather than once per session.
 *
 * WHY PER REQUEST. The transport is stateless, so there is no session state for an
 * authorisation decision to be cached against — every request carries its own
 * credential and is decided on its own. The source assertions at the bottom of this
 * file keep it that way, so the per-request rule cannot quietly come to rest on
 * session state introduced later.
 *
 * WHY THE IDENTITY PROBE HAS A POSITIVE CONTROL.
 * "Identity is never reached on a refusal" is an absence assertion, and an absence
 * assertion measured with a broken instrument is indistinguishable from a true one — a
 * spy that is never wired up reports zero calls for a refusal and for an acceptance
 * alike. So every test that requires the probe NOT to fire is paired with one that
 * requires it TO fire, through the same chain and the same spy.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { serveForTest } from '../../test/sharedServer.js';
import { FireModel, ModelStatus } from '../../domain/entities/index.js';

// ─── Mocks: the MCP tools touch the database at module load ──────
const mockModels = new Map<string, FireModel>();

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
    find: vi.fn(async () => ({ models: [], totalCount: 0, hasMore: false })),
    updateStatus: vi.fn(async (id: string, status: ModelStatus) => {
      const model = mockModels.get(id);
      if (!model) throw new Error('Not found');
      const updated = model.withStatus(status);
      mockModels.set(id, updated);
      return updated;
    }),
    getConfigJson: vi.fn(async () => null),
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

const { resolveMcpConfig, mountMcpChain, MCP_KEY_HEADER } = await import('../auth.js');

const KEY = 'k'.repeat(48);
const IDENTITY = 'franco@example.org';

/** A valid MCP `initialize` body — the one request that is legitimate with no session. */
const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'test', version: '1.0.0' },
  },
};

/** Any non-initialize call. Legitimate shape, refused for want of a key. */
const TOOLS_LIST = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };

/**
 * Typed deliberately rather than left as `ReturnType<typeof vi.fn>`.
 *
 * The loose form is assignable to nothing, so `tsc` rejected it at both call sites —
 * and had the chain's parameter been `any` instead, an untyped probe would have
 * silently accepted a wrong signature and reported zero calls forever. The spy whose
 * calls an absence assertion depends on is exactly the thing to type strictly.
 */
type IdentityProbe = (req: Request, res: Response, next: NextFunction) => void;

let identityProbe: Mock<IdentityProbe>;

beforeEach(() => {
  mockModels.clear();
  identityProbe = vi.fn<IdentityProbe>((_req, _res, next) => next());
});

/**
 * Builds an app the way production does: the chain decides mount and order, not
 * the call site. Passing `config: null` must leave no route behind.
 */
function buildApp(config: { authKey: string; identity: string } | null): Application {
  const app = express();
  app.use(express.json());
  mountMcpChain(app, { config, path: '/mcp', identityMiddleware: identityProbe });
  return app;
}

// ─── Startup configuration: fail closed, never degrade ───────────

describe('resolveMcpConfig — partial configuration is fatal, not degraded', () => {
  it('returns null when neither key nor identity is set, so nothing is mounted', () => {
    expect(resolveMcpConfig({})).toBeNull();
  });

  it('throws when a key is set without an identity, naming the identity as missing', () => {
    expect(() => resolveMcpConfig({ NOMAD_MCP_AUTH_KEY: KEY })).toThrowError(
      /NOMAD_MCP_IDENTITY/,
    );
  });

  it('throws when an identity is set without a key, naming the key as missing', () => {
    expect(() => resolveMcpConfig({ NOMAD_MCP_IDENTITY: IDENTITY })).toThrowError(
      /NOMAD_MCP_AUTH_KEY/,
    );
  });

  it('returns both values when both are set', () => {
    expect(
      resolveMcpConfig({ NOMAD_MCP_AUTH_KEY: KEY, NOMAD_MCP_IDENTITY: IDENTITY }),
    ).toEqual({ authKey: KEY, identity: IDENTITY });
  });

  // The next two both name NOMAD_MCP_AUTH_KEY, so `/NOMAD_MCP_AUTH_KEY/` alone
  // cannot tell them apart — a matcher that two different failure paths satisfy is
  // a coincidence, not an assertion. Each therefore matches text only its own path
  // produces: a character count for the short key, "is not set" for the blank one.
  it('rejects a key below the minimum length', () => {
    expect(() =>
      resolveMcpConfig({ NOMAD_MCP_AUTH_KEY: 'short', NOMAD_MCP_IDENTITY: IDENTITY }),
    ).toThrowError(/NOMAD_MCP_AUTH_KEY is 5 characters, which is below the 32-character floor/);
  });

  it('treats a whitespace-only key as absent rather than as a configured secret', () => {
    expect(() =>
      resolveMcpConfig({ NOMAD_MCP_AUTH_KEY: '   ', NOMAD_MCP_IDENTITY: IDENTITY }),
    ).toThrowError(/NOMAD_MCP_AUTH_KEY is not set while NOMAD_MCP_IDENTITY is/);
  });
});

// ─── Condition 1: unconfigured means ABSENT, not open ────────────

describe('no key configured — the route does not exist', () => {
  const api = serveForTest(() => buildApp(null));

  it('answers 404 for POST, so the endpoint is absent rather than present-and-open', async () => {
    const res = await request(api()).post('/mcp').send(INITIALIZE);
    expect(res.status).toBe(404);
  });

  it('answers 404 for GET', async () => {
    expect((await request(api()).get('/mcp')).status).toBe(404);
  });

  it('answers 404 for DELETE', async () => {
    expect((await request(api()).delete('/mcp')).status).toBe(404);
  });

  it('never reaches identity, because there is no route to reach it through', async () => {
    await request(api()).post('/mcp').send(INITIALIZE);
    expect(identityProbe).not.toHaveBeenCalled();
  });
});

// ─── Condition 2: every request, every verb, header only ─────────

describe('key configured — every request is checked', () => {
  const api = serveForTest(() => buildApp({ authKey: KEY, identity: IDENTITY }));

  it('refuses an initialize POST with no key', async () => {
    const res = await request(api()).post('/mcp').send(INITIALIZE);
    expect(res.status).toBe(403);
  });

  it('refuses a non-initialize POST with no key', async () => {
    const res = await request(api()).post('/mcp').send(TOOLS_LIST);
    expect(res.status).toBe(403);
  });

  it('refuses a wrong key of the same length, so the compare is on content', async () => {
    const res = await request(api())
      .post('/mcp')
      .set(MCP_KEY_HEADER, 'x'.repeat(KEY.length))
      .send(INITIALIZE);
    expect(res.status).toBe(403);
  });

  it('refuses a key that is a prefix of the real one', async () => {
    const res = await request(api())
      .post('/mcp')
      .set(MCP_KEY_HEADER, KEY.slice(0, -1))
      .send(INITIALIZE);
    expect(res.status).toBe(403);
  });

  it('refuses GET with no key', async () => {
    expect((await request(api()).get('/mcp')).status).toBe(403);
  });

  it('refuses DELETE with no key', async () => {
    expect((await request(api()).delete('/mcp')).status).toBe(403);
  });

  // These two exist because mutation found the pair above proves LESS than it looks.
  // `mountMcpChain` guards the path with `app.use`, which matches every verb, so the
  // 403s above are produced by the guard whether or not the verb handlers are
  // registered at all — deleting both registrations left the suite green. What the
  // registrations actually decide is the answer an AUTHENTICATED caller gets: 405
  // ("here, but not that verb") rather than 404 ("no such endpoint").
  it('answers an authenticated GET with 405, not the 404 of an absent route', async () => {
    const res = await request(api()).get('/mcp').set(MCP_KEY_HEADER, KEY);
    expect(res.status).toBe(405);
    expect(res.body?.error?.message).toMatch(/stateless/);
  });

  it('answers an authenticated DELETE with 405, not the 404 of an absent route', async () => {
    const res = await request(api()).delete('/mcp').set(MCP_KEY_HEADER, KEY);
    expect(res.status).toBe(405);
  });

  it('refuses a key supplied as a query parameter — the header is the only channel', async () => {
    const res = await request(api())
      .post(`/mcp?${MCP_KEY_HEADER}=${KEY}`)
      .send(INITIALIZE);
    expect(res.status).toBe(403);
  });

  it('accepts the correct key and REACHES THE MCP SERVER, not merely "not 403"', async () => {
    // `not.toBe(403)` would be satisfied by a 404 — which is exactly what this
    // test reported while the chain mounted a guard and no terminal handler. A
    // refusal and an unmounted route are both "not 403", so the assertion has to
    // name something only the real transport can produce: an initialize RESULT
    // carrying this server's own name.
    const res = await request(api())
      .post('/mcp')
      .set(MCP_KEY_HEADER, KEY)
      .set('Accept', 'application/json, text/event-stream')
      .send(INITIALIZE);

    expect(res.status).toBe(200);
    expect(res.text).toContain('nomad-fire-modeling');
  });
});

// ─── Condition 6: refusal shape, and identity is never reached ───

describe('refusals are uniform, and cost nothing beyond the guard', () => {
  const api = serveForTest(() => buildApp({ authKey: KEY, identity: IDENTITY }));

  it('is 403 and not 401 — refusals do not vary with the reason', async () => {
    const res = await request(api()).post('/mcp').send(INITIALIZE);
    expect(res.status).toBe(403);
    expect(res.status).not.toBe(401);
  });

  it('does not name the header, the key or any internal path in the body', async () => {
    const res = await request(api()).post('/mcp').send(INITIALIZE);
    const body = JSON.stringify(res.body) + res.text;
    expect(body).not.toContain(KEY);
    expect(body).not.toContain(MCP_KEY_HEADER);
    expect(body).not.toMatch(/src\/|node_modules|\.ts:/);
  });

  it('never reaches identity resolution on a refusal', async () => {
    await request(api()).post('/mcp').send(INITIALIZE);
    await request(api()).post('/mcp').set(MCP_KEY_HEADER, 'wrong').send(INITIALIZE);
    await request(api()).get('/mcp');
    await request(api()).delete('/mcp');
    expect(identityProbe).not.toHaveBeenCalled();
  });

  it('POSITIVE CONTROL: the same probe DOES fire on an accepted request', async () => {
    await request(api())
      .post('/mcp')
      .set(MCP_KEY_HEADER, KEY)
      .set('Accept', 'application/json, text/event-stream')
      .send(INITIALIZE);
    expect(identityProbe).toHaveBeenCalled();
  });

});

// ─── A broken recorder must not be able to speak ─────────────────

describe('recording a refusal cannot change the answer the refusal gets', () => {
  // The guard runs ahead of identity by design, so `req.user` does not exist yet. A
  // recorder written as though it did would throw, and an unhandled throw inside the
  // guard would replace the intended 403 with a generic 500. The recorder is therefore
  // allowed to fail, and is never allowed to affect the response.
  //
  // This server is built through `serveForTest` rather than `app.listen(0)`. The
  // first version used the latter and the #480 convention guard failed the build:
  // listening on the OS ephemeral range collides with client source ports and sends
  // the request to an unrelated process, which is one fault with five faces. The
  // guard was right and my test was wrong.
  const refusals: string[] = [];

  const api = serveForTest(() => {
    const app = express();
    app.use(express.json());
    mountMcpChain(app, {
      config: { authKey: KEY, identity: IDENTITY },
      path: '/mcp',
      identityMiddleware: identityProbe,
      onRefusal: (reason) => {
        refusals.push(reason);
        throw new Error('recorder is broken');
      },
    });
    return app;
  });

  beforeEach(() => {
    refusals.length = 0;
  });

  it('still answers 403 when the recorder throws', async () => {
    const res = await request(api()).post('/mcp').send(INITIALIZE);
    expect(res.status).toBe(403);
  });

  it('records the refusal, and distinguishes a missing key from a wrong one', async () => {
    await request(api()).post('/mcp').send(INITIALIZE);
    await request(api()).post('/mcp').set(MCP_KEY_HEADER, 'x'.repeat(48)).send(INITIALIZE);
    // The two causes are operationally different: nothing presented at all is a
    // misconfigured client, a wrong value is someone guessing.
    expect(refusals).toEqual(['missing-key', 'invalid-key']);
  });
});

// ─── Condition 3: statelessness, asserted against the source ─────

describe('the transport is stateless, so no session id can become a credential', () => {
  /**
   * Strips comments so the assertion measures CODE.
   *
   * The first version of this test failed, correctly and for the wrong reason: the
   * doc comment at the top of `mcp/index.ts` explains why `randomUUID` was removed,
   * and therefore contains the word. A source grep cannot tell prose from code, so an
   * honest explanation of a removal reads to it exactly like the removal not having
   * happened. Rewording the comment would have made the test pass by deleting the
   * history it exists to preserve — the instrument was wrong, not the file.
   */
  function codeOnly(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  }

  it('the comment stripper works in both directions — CONTROL for the test below', () => {
    // A known positive: text that exists only inside a comment must be removed.
    expect(codeOnly('/* randomUUID */ const a = 1;')).not.toMatch(/randomUUID/);
    expect(codeOnly('// randomUUID\nconst a = 1;')).not.toMatch(/randomUUID/);
    // A known negative: real code must SURVIVE. Without this half, a stripper that
    // returned the empty string would pass every assertion in the next test.
    expect(codeOnly('/* comment */ const x = randomUUID();')).toMatch(/randomUUID/);
    expect(codeOnly('const t = new Map(); // transports')).toMatch(/new Map/);
  });

  it('has no session map and mints no session ids in mcp/index.ts', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const raw = readFileSync(join(import.meta.dirname, '../index.ts'), 'utf8');
    const src = codeOnly(raw);

    // Positive control: the file is the one I think it is, it was read, and the
    // stripper has not reduced it to nothing.
    expect(src).toContain('mountMcpServer');
    expect(src.length).toBeGreaterThan(500);

    expect(src).not.toMatch(/randomUUID/);
    expect(src).not.toMatch(/\btransports\b/);
    expect(src).toMatch(/sessionIdGenerator:\s*undefined/);
  });
});
