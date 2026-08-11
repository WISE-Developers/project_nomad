import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, stat, mkdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlUsageLogger } from '../JsonlUsageLogger.js';
import { createUsageEvent } from '../../../application/usage/usageEvent.js';
import type { UsageEventType } from '../../../domain/value-objects/UsageEvent.js';

const ZONE = 'America/Edmonton';
const NOW = new Date('2026-08-10T21:14:22.000Z');

function event(type: UsageEventType, actor = 'User', detail?: Record<string, unknown>) {
  return createUsageEvent({ type, actor, zone: ZONE, now: NOW, detail });
}

async function lines(path: string): Promise<string[]> {
  const raw = await readFile(path, 'utf8');
  return raw.split('\n').filter((l) => l.length > 0);
}

describe('JsonlUsageLogger', () => {
  let dir: string;
  let logPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nomad-usage-'));
    logPath = join(dir, 'usage.jsonl');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('append-only writing', () => {
    it('writes one JSON object per line', async () => {
      const log = new JsonlUsageLogger({ filePath: logPath });
      await log.record(event('app.started', 'System'));
      await log.record(event('model.run.started'));

      const l = await lines(logPath);
      expect(l).toHaveLength(2);
      expect(JSON.parse(l[0]).type).toBe('app.started');
      expect(JSON.parse(l[1]).type).toBe('model.run.started');
    });

    it('round-trips every field of an event', async () => {
      const log = new JsonlUsageLogger({ filePath: logPath });
      const e = event('model.run.failed', 'franco@example.ca', { reason: 'no fuel' });
      await log.record(e);

      const parsed = JSON.parse((await lines(logPath))[0]);
      expect(parsed).toMatchObject({
        id: e.id,
        type: 'model.run.failed',
        ts_utc: e.ts_utc,
        ts_local: e.ts_local,
        actor: 'franco@example.ca',
        detail: { reason: 'no fuel' },
      });
    });

    it('appends to an existing log rather than truncating it', async () => {
      const first = new JsonlUsageLogger({ filePath: logPath });
      await first.record(event('app.started', 'System'));

      const second = new JsonlUsageLogger({ filePath: logPath });
      await second.record(event('session.login', 'franco'));

      expect(await lines(logPath)).toHaveLength(2);
    });

    it('creates the log directory if it does not exist', async () => {
      const nested = join(dir, 'a', 'b', 'usage.jsonl');
      const log = new JsonlUsageLogger({ filePath: nested });
      await log.record(event('app.started', 'System'));
      expect(await lines(nested)).toHaveLength(1);
    });

    it('never interleaves concurrent writes', async () => {
      const log = new JsonlUsageLogger({ filePath: logPath });
      await Promise.all(
        Array.from({ length: 50 }, () => log.record(event('model.run.started')))
      );

      const l = await lines(logPath);
      expect(l).toHaveLength(50);
      for (const line of l) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    });

    it('writes the file with owner-only permissions', async () => {
      const log = new JsonlUsageLogger({ filePath: logPath });
      await log.record(event('app.started', 'System'));

      const mode = (await stat(logPath)).mode & 0o777;
      expect(mode & 0o077).toBe(0);
    });
  });

  describe('never fails the caller', () => {
    it('does not throw when the log cannot be written', async () => {
      const blocked = join(dir, 'blocked');
      await mkdir(blocked);
      await writeFile(join(blocked, 'usage.jsonl'), '');
      await chmod(join(blocked, 'usage.jsonl'), 0o400);
      await chmod(blocked, 0o500);

      const log = new JsonlUsageLogger({ filePath: join(blocked, 'usage.jsonl') });
      await expect(log.record(event('model.run.started'))).resolves.toBeUndefined();

      await chmod(blocked, 0o700);
    });

    it('logs the failure loudly rather than swallowing it', async () => {
      const onError = vi.fn();
      const blocked = join(dir, 'blocked2');
      await mkdir(blocked);
      await chmod(blocked, 0o500);

      const log = new JsonlUsageLogger({
        filePath: join(blocked, 'usage.jsonl'),
        onError,
      });
      await log.record(event('model.run.started'));

      expect(onError).toHaveBeenCalledTimes(1);

      await chmod(blocked, 0o700);
    });
  });

  describe('retention', () => {
    it('rotates once the log exceeds the size bound', async () => {
      const log = new JsonlUsageLogger({ filePath: logPath, maxBytes: 1024 });
      for (let i = 0; i < 200; i++) {
        await log.record(event('model.run.started'));
      }

      const size = (await stat(logPath)).size;
      expect(size).toBeLessThanOrEqual(1024 * 2);
    });

    it('re-writes the current segment header at the top of the rotated file', async () => {
      // The segment header (app.started, carrying auth_mode) is what makes every
      // following event interpretable. Retention deletes the oldest lines first,
      // so without re-writing it the log becomes unreadable exactly as it ages.
      const log = new JsonlUsageLogger({ filePath: logPath, maxBytes: 1024 });
      await log.record(
        event('app.started', 'System', { auth_mode: 'simple', version: '0.12.1' })
      );
      for (let i = 0; i < 200; i++) {
        await log.record(event('model.run.started'));
      }

      const l = await lines(logPath);
      const first = JSON.parse(l[0]);
      expect(first.type).toBe('app.started');
      expect(first.detail.auth_mode).toBe('simple');
    });

    it('marks the re-written header so it is not counted as a real restart', async () => {
      const log = new JsonlUsageLogger({ filePath: logPath, maxBytes: 1024 });
      await log.record(event('app.started', 'System', { auth_mode: 'simple' }));
      for (let i = 0; i < 200; i++) {
        await log.record(event('model.run.started'));
      }

      const first = JSON.parse((await lines(logPath))[0]);
      expect(first.detail.rewritten_by_rotation).toBe(true);
    });

    it('keeps the most recent events, discarding the oldest', async () => {
      const log = new JsonlUsageLogger({ filePath: logPath, maxBytes: 1024 });
      await log.record(event('app.started', 'System', { auth_mode: 'none' }));
      for (let i = 0; i < 200; i++) {
        await log.record(event('model.run.started', 'User', { seq: i }));
      }

      const l = await lines(logPath);
      const seqs = l
        .map((x) => JSON.parse(x))
        .filter((e) => e.type === 'model.run.started')
        .map((e) => e.detail.seq);
      expect(seqs[seqs.length - 1]).toBe(199);
      expect(seqs[0]).toBeGreaterThan(0);
    });

    it('does not rotate when no bound is configured', async () => {
      const log = new JsonlUsageLogger({ filePath: logPath });
      for (let i = 0; i < 200; i++) {
        await log.record(event('model.run.started', 'User', { seq: i }));
      }
      expect(await lines(logPath)).toHaveLength(200);
    });
  });
});
