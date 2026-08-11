import { describe, it, expect, vi } from 'vitest';
import { resolveUsageAuthMode, recordAppStarted } from '../appStarted.js';
import type { IUsageLogger } from '../../interfaces/IUsageLogger.js';
import type { UsageEvent } from '../../../domain/value-objects/UsageEvent.js';

const NOW = new Date('2026-08-10T21:14:22.000Z');

function fakeLogger(): IUsageLogger & { events: UsageEvent[] } {
  const events: UsageEvent[] = [];
  return {
    events,
    record: async (e) => {
      events.push(e);
    },
  };
}

/**
 * app.started is the segment boundary (#332). NOMAD_AUTH_MODE is an env var, so
 * a mode change requires a restart - which means the auth_mode recorded here is
 * authoritative for every event until the next app.started.
 *
 * It must therefore be emitted unconditionally at every boot. Without it the
 * segment is unreadable.
 */

describe('resolveUsageAuthMode', () => {
  // ACN is a separate axis from NOMAD_AUTH_MODE: the existing AuthMode type is
  // none|simple|oauth, and ACN deployments carry identity by agency headers.
  it('reports acn when the deployment mode is ACN, whatever the auth mode says', () => {
    expect(resolveUsageAuthMode({ deploymentMode: 'ACN', authMode: 'oauth' })).toBe('acn');
    expect(resolveUsageAuthMode({ deploymentMode: 'ACN', authMode: 'none' })).toBe('acn');
  });

  it('passes through the auth mode for SAN deployments', () => {
    expect(resolveUsageAuthMode({ deploymentMode: 'SAN', authMode: 'none' })).toBe('none');
    expect(resolveUsageAuthMode({ deploymentMode: 'SAN', authMode: 'simple' })).toBe('simple');
    expect(resolveUsageAuthMode({ deploymentMode: 'SAN', authMode: 'oauth' })).toBe('oauth');
  });
});

describe('recordAppStarted', () => {
  const base = {
    zone: 'America/Edmonton',
    deploymentMode: 'SAN' as const,
    authMode: 'simple' as const,
    version: '0.12.1',
    now: NOW,
  };

  it('records exactly one app.started event', async () => {
    const log = fakeLogger();
    await recordAppStarted({ ...base, usageLogger: log });
    expect(log.events).toHaveLength(1);
    expect(log.events[0].type).toBe('app.started');
  });

  it('attributes the event to "System", not to a person', async () => {
    const log = fakeLogger();
    await recordAppStarted({ ...base, usageLogger: log });
    expect(log.events[0].actor).toBe('System');
  });

  it('carries the segment header fields — auth mode, version, deployment mode', async () => {
    const log = fakeLogger();
    await recordAppStarted({ ...base, usageLogger: log });
    expect(log.events[0].detail).toMatchObject({
      auth_mode: 'simple',
      deployment_mode: 'SAN',
      nomad_version: '0.12.1',
    });
  });

  it('records acn as the auth mode for an ACN deployment', async () => {
    const log = fakeLogger();
    await recordAppStarted({ ...base, deploymentMode: 'ACN', usageLogger: log });
    expect(log.events[0].detail).toMatchObject({ auth_mode: 'acn' });
  });

  it('stamps both timestamps in the configured zone', async () => {
    const log = fakeLogger();
    await recordAppStarted({ ...base, usageLogger: log });
    expect(log.events[0].ts_utc).toBe('2026-08-10T21:14:22.000Z');
    expect(log.events[0].ts_local).toBe('2026-08-10T15:14:22.000-06:00');
  });

  it('is not marked as a rotation artefact — this is a genuine boot', async () => {
    const log = fakeLogger();
    await recordAppStarted({ ...base, usageLogger: log });
    expect(log.events[0].detail?.rewritten_by_rotation).toBeUndefined();
  });

  it('does not throw when the usage logger fails — boot must not depend on the log', async () => {
    const failing: IUsageLogger = {
      record: vi.fn().mockRejectedValue(new Error('disk full')),
    };
    await expect(
      recordAppStarted({ ...base, usageLogger: failing })
    ).resolves.toBeUndefined();
  });

  it('throws on an invalid zone rather than booting with a wrong clock', async () => {
    const log = fakeLogger();
    await expect(
      recordAppStarted({ ...base, zone: 'America/Nowhere', usageLogger: log })
    ).rejects.toThrow(/America\/Nowhere/);
    expect(log.events).toHaveLength(0);
  });
});
