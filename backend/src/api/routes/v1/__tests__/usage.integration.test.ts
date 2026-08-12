import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { usageRouter } from '../usage.js';
import { JsonlUsageLogger } from '../../../../infrastructure/usage/JsonlUsageLogger.js';
import { createUsageEvent } from '../../../../application/usage/usageEvent.js';
import type { UsageEventType } from '../../../../domain/value-objects/UsageEvent.js';

const TOKEN = 'c'.repeat(32);
const ZONE = 'America/Edmonton';

/**
 * End to end through the REAL adapter and the REAL router - no fakes.
 *
 * The unit tests prove each half in isolation; this proves they fit: events
 * written as JSONL come back out of the endpoint intact, in the right order.
 */
describe('usage endpoint over the real JSONL log', () => {
  let dir: string;
  let logPath: string;
  let app: express.Express;
  let adapter: JsonlUsageLogger;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nomad-usage-e2e-'));
    logPath = join(dir, 'usage.jsonl');
    adapter = new JsonlUsageLogger({ filePath: logPath });

    app = express();
    app.use(
      usageRouter({
        query: adapter,
        usageLogger: adapter,
        token: TOKEN,
        homeTimezone: ZONE,
        authMode: 'simple',
      })
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function write(type: UsageEventType, actor: string, when: string) {
    await adapter.record(
      createUsageEvent({ type, actor, zone: ZONE, now: new Date(when) })
    );
  }

  it('returns an empty result when no log exists yet', async () => {
    const res = await request(app)
      .get('/usage')
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(200);

    expect(res.body.events).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('round-trips written events back through the endpoint', async () => {
    await write('app.started', 'System', '2026-08-10T12:00:00.000Z');
    await write('model.run.started', 'franco@example.ca', '2026-08-10T13:00:00.000Z');

    const res = await request(app)
      .get('/usage')
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(200);

    // 2 written + the usage.read this request itself records.
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    const types = res.body.events.map((e: { type: string }) => e.type);
    expect(types).toContain('app.started');
    expect(types).toContain('model.run.started');
  });

  it('returns newest first, ordered by ts_utc', async () => {
    await write('model.run.started', 'a@example.ca', '2026-08-10T10:00:00.000Z');
    await write('model.run.completed', 'a@example.ca', '2026-08-10T11:00:00.000Z');

    const res = await request(app)
      .get('/usage?type=model.run.started,model.run.completed')
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(200);

    expect(res.body.events[0].type).toBe('model.run.completed');
    expect(res.body.events[1].type).toBe('model.run.started');
  });

  it('filters by event type', async () => {
    await write('session.login', 'franco@example.ca', '2026-08-10T10:00:00.000Z');
    await write('model.run.failed', 'franco@example.ca', '2026-08-10T11:00:00.000Z');

    const res = await request(app)
      .get('/usage?type=model.run.failed')
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(200);

    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].type).toBe('model.run.failed');
  });

  it('preserves both timestamps through the round trip', async () => {
    await write('model.run.started', 'franco@example.ca', '2026-08-10T21:14:22.000Z');

    const res = await request(app)
      .get('/usage?type=model.run.started')
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(200);

    expect(res.body.events[0].ts_utc).toBe('2026-08-10T21:14:22.000Z');
    expect(res.body.events[0].ts_local).toBe('2026-08-10T15:14:22.000-06:00');
  });

  it('reports truncation rather than implying the response is complete', async () => {
    for (let i = 0; i < 10; i++) {
      await write('model.run.started', 'franco@example.ca', '2026-08-10T10:00:00.000Z');
    }

    const res = await request(app)
      .get('/usage?limit=3')
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(200);

    expect(res.body.events).toHaveLength(3);
    expect(res.body.truncated).toBe(true);
    expect(res.body.total).toBeGreaterThan(3);
  });

  it('survives a corrupt line instead of failing the whole query', async () => {
    // A log truncated mid-write by a full disk must still yield what surrounds
    // the damage - losing everything because one line is bad is the worse
    // failure.
    await write('model.run.started', 'franco@example.ca', '2026-08-10T10:00:00.000Z');
    const { appendFile } = await import('node:fs/promises');
    await appendFile(logPath, '{"id":"broken","type":"model.run\n');
    await write('model.run.completed', 'franco@example.ca', '2026-08-10T11:00:00.000Z');

    const res = await request(app)
      .get('/usage?type=model.run.started,model.run.completed')
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(200);

    expect(res.body.events).toHaveLength(2);
  });
});
