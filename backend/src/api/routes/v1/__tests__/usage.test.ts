import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { usageRouter, isUsageEndpointEnabled, resolveUsageToken } from '../usage.js';
import type { IUsageQuery } from '../../../../application/interfaces/IUsageQuery.js';
import type { IUsageLogger } from '../../../../application/interfaces/IUsageLogger.js';
import type { UsageEvent } from '../../../../domain/value-objects/UsageEvent.js';

const TOKEN = 'a'.repeat(32);

function fakeEvents(n: number): UsageEvent[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    type: 'model.run.started' as const,
    ts_utc: '2026-08-10T21:14:22.000Z',
    ts_local: '2026-08-10T15:14:22.000-06:00',
    actor: 'franco@example.ca',
  }));
}

function fakeQuery(events: UsageEvent[] = fakeEvents(3)): IUsageQuery & { lastLimit?: number } {
  const q: IUsageQuery & { lastLimit?: number } = {
    query: async (opts) => {
      q.lastLimit = opts.limit;
      return { events: events.slice(0, opts.limit), total: events.length };
    },
  };
  return q;
}

function collectingLogger(): IUsageLogger & { events: UsageEvent[] } {
  const events: UsageEvent[] = [];
  return { events, record: async (e) => { events.push(e); } };
}

function makeApp(opts: {
  query?: IUsageQuery;
  logger?: IUsageLogger;
  token?: string;
} = {}) {
  const app = express();
  app.use(
    usageRouter({
      query: opts.query ?? fakeQuery(),
      usageLogger: opts.logger ?? collectingLogger(),
      token: opts.token ?? TOKEN,
      homeTimezone: 'America/Edmonton',
    })
  );
  return app;
}

describe('usage endpoint: registration is fail-closed', () => {
  const original = process.env.NOMAD_USAGE_API_TOKEN;

  beforeEach(() => {
    delete process.env.NOMAD_USAGE_API_TOKEN;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.NOMAD_USAGE_API_TOKEN;
    else process.env.NOMAD_USAGE_API_TOKEN = original;
  });

  it('is disabled when no token is configured', () => {
    expect(isUsageEndpointEnabled()).toBe(false);
  });

  it('is enabled only once a token is configured', () => {
    process.env.NOMAD_USAGE_API_TOKEN = TOKEN;
    expect(isUsageEndpointEnabled()).toBe(true);
  });

  it('rejects a token that is too short to be worth having', () => {
    process.env.NOMAD_USAGE_API_TOKEN = 'short';
    expect(() => resolveUsageToken()).toThrow(/NOMAD_USAGE_API_TOKEN/);
  });

  it('rejects a whitespace-only token rather than treating it as set', () => {
    process.env.NOMAD_USAGE_API_TOKEN = '                                   ';
    expect(() => resolveUsageToken()).toThrow();
  });
});

describe('usage endpoint: authentication', () => {
  it('refuses a request with no Authorization header', async () => {
    await request(makeApp()).get('/usage').expect(401);
  });

  it('refuses a wrong token', async () => {
    await request(makeApp())
      .get('/usage')
      .set('Authorization', `Bearer ${'b'.repeat(32)}`)
      .expect(401);
  });

  it('refuses a token that is a prefix of the real one', async () => {
    await request(makeApp())
      .get('/usage')
      .set('Authorization', `Bearer ${'a'.repeat(31)}`)
      .expect(401);
  });

  it('refuses a non-Bearer scheme', async () => {
    await request(makeApp()).get('/usage').set('Authorization', TOKEN).expect(401);
  });

  it('accepts the correct token', async () => {
    await request(makeApp())
      .get('/usage')
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(200);
  });

  it('does not leak whether the token was wrong or merely absent', async () => {
    const absent = await request(makeApp()).get('/usage');
    const wrong = await request(makeApp())
      .get('/usage')
      .set('Authorization', 'Bearer nope');
    expect(absent.body).toEqual(wrong.body);
  });
});

describe('usage endpoint: responses are bounded', () => {
  it('applies a default limit rather than returning everything', async () => {
    const q = fakeQuery(fakeEvents(5000));
    await request(makeApp({ query: q }))
      .get('/usage')
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(200);
    expect(q.lastLimit).toBeLessThanOrEqual(1000);
  });

  it('clamps a caller-supplied limit that is too large', async () => {
    const q = fakeQuery(fakeEvents(5000));
    await request(makeApp({ query: q }))
      .get('/usage?limit=99999')
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(200);
    expect(q.lastLimit).toBeLessThanOrEqual(1000);
  });

  it('honours a smaller caller-supplied limit', async () => {
    const q = fakeQuery(fakeEvents(100));
    await request(makeApp({ query: q }))
      .get('/usage?limit=5')
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(200);
    expect(q.lastLimit).toBe(5);
  });

  it('rejects a nonsense limit instead of silently defaulting', async () => {
    await request(makeApp())
      .get('/usage?limit=-1')
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(400);
  });
});

describe('usage endpoint: reads are themselves recorded', () => {
  it('records a usage.read event on a successful read', async () => {
    const log = collectingLogger();
    await request(makeApp({ logger: log }))
      .get('/usage')
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(200);

    expect(log.events).toHaveLength(1);
    expect(log.events[0].type).toBe('usage.read');
  });

  it('records a rejected read too — a failed access attempt is the point', async () => {
    const log = collectingLogger();
    await request(makeApp({ logger: log })).get('/usage').expect(401);

    expect(log.events).toHaveLength(1);
    expect(log.events[0].type).toBe('usage.read');
    expect(log.events[0].detail?.authorised).toBe(false);
  });

  it('never puts the presented token into the log', async () => {
    const log = collectingLogger();
    await request(makeApp({ logger: log }))
      .get('/usage')
      .set('Authorization', 'Bearer super-secret-value')
      .expect(401);

    expect(JSON.stringify(log.events)).not.toContain('super-secret-value');
  });
});
