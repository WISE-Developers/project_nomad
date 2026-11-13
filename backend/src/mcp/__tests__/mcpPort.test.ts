/**
 * MCP listens on its own loopback port, and the reason is not obvious.
 *
 * The instinct is "only allow MCP over the tunnel", implemented as a loopback check on
 * the port the app already serves. BEHIND A SAME-HOST PROXY THAT AUTHORISES THE WHOLE
 * INTERNET: such a proxy terminates at the edge and forwards to a loopback address, so
 * `req.socket.remoteAddress` is loopback for every public visitor and a guard built on
 * it cannot tell them from an administrator at a terminal.
 *
 * The fix is a port the proxy does not route to. A proxy that forwards only the
 * hostnames it lists, and answers everything else with a 404, cannot reach a port it
 * has no entry for — so reaching that port requires a shell on the host. That is a
 * real boundary, and it needs no proxy configuration change at all: this design is
 * correct precisely when it leaves that configuration untouched.
 *
 * WHICH CONTROL IS LOAD-BEARING, because I had this backwards and said so. The port is
 * defence in depth. Unless an SSH daemon restricts forwarding per account, any account
 * with a shell can forward to a loopback port, so the port does not narrow access to
 * one operator — the KEY does. Both are needed and they are not interchangeable.
 *
 * NO SILENT DEFAULT FOR THE PORT. Deriving one (PORT + 1, say) would mean the endpoint
 * picks its own address, and an operator reading the config would not be able to tell
 * where it is listening. A missing port is a configuration someone did not finish, so
 * it stops the process instead.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import { serveForTest } from '../../test/sharedServer.js';
import { FireModel, ModelStatus } from '../../domain/entities/index.js';

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
      return model.withStatus(status);
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

const { resolveMcpPort, createMcpApp, startMcpListener } = await import('../listener.js');
const { MCP_KEY_HEADER } = await import('../auth.js');

const KEY = 'k'.repeat(48);
const IDENTITY = 'franco@example.org';
const CONFIG = { authKey: KEY, identity: IDENTITY };

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

// ─── The port must be chosen, never derived ──────────────────────

describe('resolveMcpPort — a missing port stops the process', () => {
  it('returns the configured port', () => {
    expect(resolveMcpPort({ NOMAD_MCP_PORT: '53101', PORT: '3001' })).toBe(53101);
  });

  it('THROWS when no MCP port is set, rather than deriving one', () => {
    expect(() => resolveMcpPort({ PORT: '3001' })).toThrowError(/NOMAD_MCP_PORT is not set/);
  });

  it('THROWS when the MCP port equals the main port', () => {
    // The separate listener is the design; sharing the application port would undo
    // it while appearing to work.
    expect(() => resolveMcpPort({ NOMAD_MCP_PORT: '3001', PORT: '3001' })).toThrowError(
      /must not be the same as the main application port/,
    );
  });

  it('THROWS when the MCP port equals the default main port and PORT is unset', () => {
    // `PORT` defaults to 3001 in index.ts. Comparing against the literal env var
    // alone would miss the collision whenever PORT is left at its default — which
    // is the common case, and so the one worth catching.
    expect(() => resolveMcpPort({ NOMAD_MCP_PORT: '3001' })).toThrowError(
      /must not be the same as the main application port/,
    );
  });

  it('THROWS on a port that is not a number', () => {
    expect(() => resolveMcpPort({ NOMAD_MCP_PORT: 'tunnel' })).toThrowError(/NOMAD_MCP_PORT/);
  });

  it('THROWS on a port outside the usable range', () => {
    expect(() => resolveMcpPort({ NOMAD_MCP_PORT: '0' })).toThrowError(/NOMAD_MCP_PORT/);
    expect(() => resolveMcpPort({ NOMAD_MCP_PORT: '70000' })).toThrowError(/NOMAD_MCP_PORT/);
  });
});

// ─── The listener binds loopback only ────────────────────────────

describe('startMcpListener binds loopback and nothing else', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (!server) return;
    const s = server;
    server = undefined;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  });

  // This test calls the real `startMcpListener` because the bind ADDRESS is the thing
  // under test and no helper can stand in for it. It makes no request, so it never
  // exercises the #480 collision — which needs a client source port to clash with a
  // server's ephemeral port — and it holds the port only for the length of the assert.
  it('binds 127.0.0.1 and not 0.0.0.0, so nothing outside the host can reach it', async () => {
    server = await startMcpListener({ config: CONFIG, port: 0, toolContext: { userId: IDENTITY } });
    const address = server.address() as { address: string; port: number };
    expect(address.address).toBe('127.0.0.1');
    expect(address.port).toBeGreaterThan(0);
  });
});

// ─── What that listener serves, and what it refuses to serve ─────

describe('the MCP app serves MCP behind the key, and serves nothing else', () => {
  // These go through `serveForTest` rather than the real listener on port 0. The first
  // version pointed supertest at a literal loopback URL for a port-0 listener and the
  // #480 guard failed the build — correctly, and not on a technicality: port 0 draws
  // from the OS ephemeral range, the same range every other process draws its client
  // source ports from, and a collision there delivers to an unrelated process.
  // `serveForTest` binds below that floor.
  //
  // Worth knowing if that guard fails you: it counts call sites TEXTUALLY, so the
  // function name written inside a comment counts as one. This paragraph is phrased to
  // avoid naming it for that reason.
  const api = serveForTest(() => createMcpApp({ config: CONFIG, toolContext: { userId: IDENTITY } }));

  it('refuses an unkeyed request and serves a keyed one', async () => {
    const refused = await request(api()).post('/mcp').send(INITIALIZE);
    expect(refused.status).toBe(403);

    const accepted = await request(api())
      .post('/mcp')
      .set(MCP_KEY_HEADER, KEY)
      .set('Accept', 'application/json, text/event-stream')
      .send(INITIALIZE);
    expect(accepted.status).toBe(200);
    expect(accepted.text).toContain('nomad-fire-modeling');
  });

  it('is NOT a second copy of the API — no routes but /mcp exist on it', async () => {
    // The listener is reachable to anyone who can forward to the port, so every route
    // it does not carry is a route that cannot be reached there by mistake.
    for (const path of ['/api/v1/models', '/health', '/api/docs', '/']) {
      expect((await request(api()).get(path)).status).toBe(404);
    }
  });
});

// ─── Nothing is published, and that is a property of the repo ────

describe('nothing is published to the host or the edge', () => {
  /** Strips comments so an assertion measures configuration, not prose about it. */
  function codeOnly(src: string): string {
    return src
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');
  }

  it('CONTROL: the comment stripper removes comments and keeps configuration', () => {
    expect(codeOnly('# ports:\n  image: x')).not.toMatch(/ports:/);
    expect(codeOnly('# note\n  ports:\n    - "1:1"')).toMatch(/ports:/);
  });

  /** Strips JS/TS comments, so an assertion measures code and not prose about code. */
  function jsCodeOnly(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  }

  it('CONTROL: the JS stripper removes comments and keeps code', () => {
    expect(jsCodeOnly('// mountMcpChain(app)\nconst a = 1;')).not.toMatch(/mountMcpChain/);
    expect(jsCodeOnly('/* x */ mountMcpChain(app, {});')).toMatch(/mountMcpChain\(app/);
  });

  it('index.ts NEVER mounts MCP on the main application app', async () => {
    // This is the regression that would silently republish the endpoint: one call to
    // mountMcpChain(app, ...) in index.ts puts /mcp back on the port the public proxy
    // forwards every path to, and nothing about it would look wrong.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = jsCodeOnly(readFileSync(join(import.meta.dirname, '../../index.ts'), 'utf8'));

    // Positive controls: the right file, read, and still wiring MCP at all — so a
    // zero here means "not mounted on app", not "scanner pointed at nothing".
    expect(src).toMatch(/startMcpListener/);
    expect(src).toMatch(/resolveMcpConfig/);
    expect(src).toMatch(/app\.listen\(PORT/);

    expect(src).not.toMatch(/mountMcpChain/);
    expect(src).not.toMatch(/mountMcpServer/);
  });

  /**
   * CHANGED 2026-11-13. This asserted `compose` must not mention `NOMAD_MCP_PORT` at
   * all — no publish of any kind. That was broader than the rule stated at the top of
   * this file, and the gap mattered:
   *
   *   MCP binds 127.0.0.1 INSIDE the container. With nothing published, the ONLY way
   *   in is `docker exec` on the box. An SSH tunnel terminates on the HOST, so
   *   `ssh -L 3002:127.0.0.1:3002` reached nothing. The design doc claimed MCP was
   *   "reachable only through an SSH tunnel"; it was not reachable by one at all.
   *
   * The boundary this file actually describes is "a port the proxy does not route to,
   * so reaching it requires a shell on the host". Publishing on the HOST'S loopback
   * preserves that completely: cloudflared's ingress names `http://localhost:53000`
   * and 404s everything else, so it cannot reach 127.0.0.1:3002, and an SSH forward
   * still requires an account with a shell.
   *
   * So the rule is not "never published" — it is "never published anywhere the edge
   * can reach". That is what is asserted now, and it is STRICTER where it counts: the
   * bind address must be a literal, because `${ANYTHING}:3002` would pass a
   * loopback-looking check on the strength of whatever a variable happened to hold.
   */
  it('publishes the MCP port on host loopback only, never where the edge can reach', async () => {
    const { readFileSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');

    const candidates = ['docker-compose.yml', 'docker-compose.yaml'].map((f) =>
      join(import.meta.dirname, '../../../..', f),
    );
    const composePath = candidates.find((p) => existsSync(p));

    // A negative is worthless without evidence the instrument found anything to
    // read. If no compose file is located, that is a failure of the test, not a pass.
    expect(composePath, 'no docker-compose file found to check').toBeDefined();

    const compose = codeOnly(readFileSync(composePath!, 'utf8'));
    // Positive control: the file is a compose file and was actually read.
    expect(compose).toMatch(/services:/);

    const mcpPublish = compose
      .split('\n')
      .filter((l) => /^\s*-\s*".*NOMAD_MCP_PORT.*"/.test(l));

    // It must be published, or a tunnel reaches nothing.
    expect(mcpPublish, 'MCP port is not published; an SSH tunnel would reach nothing').toHaveLength(1);

    // And it must be bound to a LITERAL loopback address.
    expect(mcpPublish[0]).toMatch(/"127\.0\.0\.1:/);
    expect(mcpPublish[0]).not.toMatch(/0\.0\.0\.0/);

    // The host part must not be substitutable — one .env typo must not be able to
    // publish `execute-model` and `batch-execute` on every interface.
    const hostPart = mcpPublish[0].replace(/^[^"]*"/, '').split(':')[0];
    expect(hostPart, 'bind address must be a literal, not an env substitution').toBe('127.0.0.1');
  });
});
