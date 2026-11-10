/**
 * Rate limiting on failed keys.
 *
 * The endpoint's tools start real work — `execute-model` and `batch-execute` can occupy
 * substantial CPU per run — so the number of attempts it will answer is bounded rather
 * than open-ended.
 *
 * ONE BUCKET, NOT ONE PER CALLER. The listener binds loopback, so every caller presents
 * the same remote address and per-address buckets would all be the same bucket. A
 * single counter states plainly what this endpoint is: single-operator.
 *
 * A LOCKOUT IS NOT DISTINGUISHED FROM ANY OTHER REFUSAL. Same status, same body, no
 * Retry-After: the response does not vary with the reason, and the reason is kept in
 * the server-side record instead.
 *
 * TIME IS INJECTED, NOT SLEPT. A test that waits for a real window is slow and flaky,
 * and one that mocks the global clock changes the thing it measures.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { serveForTest, serveInTest } from '../../test/sharedServer.js';
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

const { createMcpApp } = await import('../listener.js');
const { MCP_KEY_HEADER, MCP_MAX_FAILURES, MCP_LOCKOUT_MS } = await import('../auth.js');

const KEY = 'k'.repeat(48);
const WRONG = 'w'.repeat(48);
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

/** Injected clock, so windows pass without anything sleeping. */
let clock = 0;
let refusals: string[] = [];

const api = serveForTest(() =>
  createMcpApp({
    config: CONFIG,
    toolContext: { userId: IDENTITY },
    now: () => clock,
    onRefusal: (reason) => refusals.push(reason),
  }),
);

/** A fresh limiter per test: state that leaks between tests would fake both answers. */
beforeEach(() => {
  clock += MCP_LOCKOUT_MS * 10;
  refusals = [];
});

const bad = () => request(api()).post('/mcp').set(MCP_KEY_HEADER, WRONG).send(INITIALIZE);
const good = () =>
  request(api())
    .post('/mcp')
    .set(MCP_KEY_HEADER, KEY)
    .set('Accept', 'application/json, text/event-stream')
    .send(INITIALIZE);

describe('the limiter has to be able to say yes, or saying no proves nothing', () => {
  it('CONTROL: a correct key works before any failures', async () => {
    expect((await good()).status).toBe(200);
  });

  it('CONTROL: a correct key still works after SOME failures, below the threshold', async () => {
    for (let i = 0; i < MCP_MAX_FAILURES - 1; i += 1) {
      expect((await bad()).status).toBe(403);
    }
    // Without this, "locked out after N" could be passing because the key never
    // worked at all — the test would read identically.
    expect((await good()).status).toBe(200);
  });
});

describe('repeated failures lock the endpoint', () => {
  it('refuses a CORRECT key once the threshold is reached', async () => {
    for (let i = 0; i < MCP_MAX_FAILURES; i += 1) {
      await bad();
    }
    // The correct key is the point: a limiter that only refuses wrong keys has not
    // limited anything, because a wrong key was already being refused.
    expect((await good()).status).toBe(403);
  });

  it('records the lockout separately from an ordinary bad key', async () => {
    for (let i = 0; i < MCP_MAX_FAILURES; i += 1) {
      await bad();
    }
    await good();
    expect(refusals.filter((r) => r === 'invalid-key')).toHaveLength(MCP_MAX_FAILURES);
    expect(refusals.at(-1)).toBe('rate-limited');
  });

  it('is INDISTINGUISHABLE from any other refusal — no 429, nothing in the body', async () => {
    for (let i = 0; i < MCP_MAX_FAILURES; i += 1) {
      await bad();
    }
    const res = await good();
    expect(res.status).toBe(403);
    expect(res.status).not.toBe(429);
    expect(res.body).toEqual({ error: 'Forbidden' });
    expect(res.headers['retry-after']).toBeUndefined();
  });
});

describe('an ABSENT key counts toward the limit too, not only a wrong one', () => {
  // Also from mutation: removing the failure count on the missing-key branch left the
  // suite green, because every test above sends a WRONG key and none sends none at
  // all. Two branches, and I had only been exercising one of them.
  const none = () => request(api()).post('/mcp').send(INITIALIZE);

  it('locks out after repeated requests carrying no key at all', async () => {
    for (let i = 0; i < MCP_MAX_FAILURES; i += 1) {
      expect((await none()).status).toBe(403);
    }
    expect((await good()).status).toBe(403);
    expect(refusals.filter((r) => r === 'missing-key')).toHaveLength(MCP_MAX_FAILURES);
    expect(refusals.at(-1)).toBe('rate-limited');
  });

  it('counts the two kinds of failure toward the SAME limit', async () => {
    for (let i = 0; i < MCP_MAX_FAILURES - 1; i += 1) {
      await (i % 2 === 0 ? none() : bad());
    }
    expect((await good()).status).toBe(200);
  });
});

describe('the threshold and window are the values this file claims', () => {
  // Every loop above is written as `MCP_MAX_FAILURES` iterations, so those tests
  // cannot detect the constant changing — they would follow it. Mutation proved it:
  // raising the threshold to 50 left them all green. The value therefore gets an
  // assertion of its own, so changing it is a deliberate act that breaks a test
  // rather than a silent loosening of the guard.
  it('tolerates exactly 5 failures and locks out for exactly 5 minutes', () => {
    expect(MCP_MAX_FAILURES).toBe(5);
    expect(MCP_LOCKOUT_MS).toBe(300_000);
  });

  it('locks out on the 5th failure, written as a literal and not as the constant', async () => {
    for (let i = 0; i < 4; i += 1) {
      await bad();
    }
    expect((await good()).status).toBe(200);

    for (let i = 0; i < 5; i += 1) {
      await bad();
    }
    expect((await good()).status).toBe(403);
  });
});

describe('each mount has its own limiter', () => {
  // Mutation again: moving the counters to global state survived, because the app is
  // rebuilt per test and the clock is advanced between tests, so leaked state never
  // bit. Two live mounts in ONE test is what actually distinguishes them.
  // The second mount goes through `serveInTest`, which exists for an app built inside
  // a test body. A second `serveForTest` helper would have been equivalent in
  // substance but the #480 detector's allow-list matches the helper by NAME — it
  // permits `request(api(...))` literally — so a second helper under any other name
  // reads as a violation. Worth knowing before fighting it.
  it('a lockout on one mount does not lock the other', async () => {
    for (let i = 0; i < MCP_MAX_FAILURES; i += 1) {
      await bad();
    }
    expect((await good()).status).toBe(403);

    const second = createMcpApp({
      config: CONFIG,
      toolContext: { userId: IDENTITY },
      now: () => clock,
      onRefusal: () => {},
    });

    const unaffected = await request(serveInTest(second))
      .post('/mcp')
      .set(MCP_KEY_HEADER, KEY)
      .set('Accept', 'application/json, text/event-stream')
      .send(INITIALIZE);
    expect(unaffected.status).toBe(200);
  });
});

describe('the lockout is temporary, and successes do not count toward it', () => {
  it('lets the correct key through once the lockout window has passed', async () => {
    for (let i = 0; i < MCP_MAX_FAILURES; i += 1) {
      await bad();
    }
    expect((await good()).status).toBe(403);

    clock += MCP_LOCKOUT_MS + 1;
    expect((await good()).status).toBe(200);
  });

  it('is still locked one millisecond BEFORE the window expires', async () => {
    // Checking only that it unlocks eventually would pass on a limiter that never
    // locked. Both sides of the boundary are asserted.
    for (let i = 0; i < MCP_MAX_FAILURES; i += 1) {
      await bad();
    }
    clock += MCP_LOCKOUT_MS - 1;
    expect((await good()).status).toBe(403);

    clock += 2;
    expect((await good()).status).toBe(200);
  });

  it('does not count successful requests, so ordinary use never locks itself out', async () => {
    for (let i = 0; i < MCP_MAX_FAILURES * 3; i += 1) {
      expect((await good()).status).toBe(200);
    }
    expect((await good()).status).toBe(200);
  });

  it('gives a FULL fresh allowance after the window, rather than re-locking instantly', async () => {
    // Mutation found this one: deleting the reset left every test green, because a
    // correct key clears the count on its own and so hides whether the count was
    // cleared on expiry. The difference only shows through a WRONG key after the
    // window — without the reset, `failures` is still at the threshold and one more
    // bad attempt re-locks immediately instead of starting a new allowance.
    for (let i = 0; i < MCP_MAX_FAILURES; i += 1) {
      await bad();
    }
    clock += MCP_LOCKOUT_MS + 1;

    await bad();
    expect((await good()).status).toBe(200);
  });

  it('clears the failure count after a success, so stale failures do not accumulate', async () => {
    // A long-lived process would otherwise lock out an operator who mistyped the key
    // a few times across an entire week of correct use.
    for (let i = 0; i < MCP_MAX_FAILURES - 1; i += 1) {
      await bad();
    }
    expect((await good()).status).toBe(200);

    for (let i = 0; i < MCP_MAX_FAILURES - 1; i += 1) {
      await bad();
    }
    expect((await good()).status).toBe(200);
  });
});
