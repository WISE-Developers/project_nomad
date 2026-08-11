import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { createUsageEvent, resolveActor } from '../usageEvent.js';
import type { UsageEventType } from '../../../domain/value-objects/UsageEvent.js';

/**
 * Usage log event construction and identity resolution (#332).
 *
 * Two rules the whole design rests on:
 *   - ts_utc is the sort key and the basis for all duration math.
 *   - ts_local is for reading only, and carries an explicit offset so it is
 *     correct on both sides of every DST boundary.
 *
 * Every auth mode resolves to a defined actor string. There are no nulls.
 */

const SUMMER = new Date('2026-08-10T21:14:22.000Z'); // MDT, -06:00
const WINTER = new Date('2026-01-10T21:14:22.000Z'); // MST, -07:00

describe('createUsageEvent — timestamps', () => {
  it('stamps ts_utc as an ISO instant in UTC', () => {
    const e = createUsageEvent({
      type: 'app.started',
      actor: 'System',
      zone: 'America/Edmonton',
      now: SUMMER,
    });
    expect(e.ts_utc).toBe('2026-08-10T21:14:22.000Z');
  });

  it('stamps ts_local with the summer offset in the configured zone', () => {
    const e = createUsageEvent({
      type: 'app.started',
      actor: 'System',
      zone: 'America/Edmonton',
      now: SUMMER,
    });
    expect(e.ts_local).toBe('2026-08-10T15:14:22.000-06:00');
  });

  it('stamps ts_local with the winter offset for the same zone — DST observed', () => {
    const e = createUsageEvent({
      type: 'app.started',
      actor: 'System',
      zone: 'America/Edmonton',
      now: WINTER,
    });
    expect(e.ts_local).toBe('2026-01-10T14:14:22.000-07:00');
  });

  it('uses the deployment zone, not a hardcoded Mountain zone', () => {
    const e = createUsageEvent({
      type: 'app.started',
      actor: 'System',
      zone: 'America/Toronto',
      now: SUMMER,
    });
    expect(e.ts_local).toBe('2026-08-10T17:14:22.000-04:00');
  });

  it('ts_local and ts_utc describe the same instant', () => {
    for (const now of [SUMMER, WINTER]) {
      const e = createUsageEvent({
        type: 'app.started',
        actor: 'System',
        zone: 'America/Edmonton',
        now,
      });
      expect(DateTime.fromISO(e.ts_local).toMillis()).toBe(
        DateTime.fromISO(e.ts_utc).toMillis()
      );
    }
  });

  it('ts_local always carries an explicit offset — never a bare local time', () => {
    const e = createUsageEvent({
      type: 'app.started',
      actor: 'System',
      zone: 'America/Edmonton',
      now: SUMMER,
    });
    expect(e.ts_local).toMatch(/[+-]\d{2}:\d{2}$/);
  });

  it('throws on an invalid zone rather than silently stamping UTC', () => {
    expect(() =>
      createUsageEvent({
        type: 'app.started',
        actor: 'System',
        zone: 'America/Nowhere',
        now: SUMMER,
      })
    ).toThrow(/America\/Nowhere/);
  });
});

describe('createUsageEvent — common fields', () => {
  it('gives every event a unique id', () => {
    const ids = new Set(
      Array.from({ length: 100 }, () =>
        createUsageEvent({
          type: 'model.run.started',
          actor: 'User',
          zone: 'America/Edmonton',
          now: SUMMER,
        }).id
      )
    );
    expect(ids.size).toBe(100);
  });

  it('carries the event type and actor through unchanged', () => {
    const e = createUsageEvent({
      type: 'model.run.failed',
      actor: 'franco@example.ca',
      zone: 'America/Edmonton',
      now: SUMMER,
    });
    expect(e.type).toBe<UsageEventType>('model.run.failed');
    expect(e.actor).toBe('franco@example.ca');
  });

  it('includes optional detail without letting it overwrite common fields', () => {
    const e = createUsageEvent({
      type: 'model.run.completed',
      actor: 'User',
      zone: 'America/Edmonton',
      now: SUMMER,
      modelId: 'model-123',
      detail: { id: 'spoofed', ts_utc: 'spoofed', wall_clock_seconds: 42 },
    });
    expect(e.modelId).toBe('model-123');
    expect(e.id).not.toBe('spoofed');
    expect(e.ts_utc).toBe('2026-08-10T21:14:22.000Z');
    expect(e.detail?.wall_clock_seconds).toBe(42);
  });
});

describe('resolveActor — one defined string per auth mode', () => {
  it('none mode is always the literal "User"', () => {
    expect(resolveActor({ authMode: 'none' })).toBe('User');
  });

  it('simple mode uses the x-nomad-user string verbatim', () => {
    expect(resolveActor({ authMode: 'simple', header: 'franco' })).toBe('franco');
  });

  it('simple mode with the header absent is "Unknown User"', () => {
    expect(resolveActor({ authMode: 'simple' })).toBe('Unknown User');
  });

  it('simple mode with a blank header is "Unknown User", not an empty string', () => {
    expect(resolveActor({ authMode: 'simple', header: '   ' })).toBe('Unknown User');
  });

  it('oauth mode uses the session email, not the display name', () => {
    expect(
      resolveActor({ authMode: 'oauth', email: 'franco@example.ca', name: 'Franco' })
    ).toBe('franco@example.ca');
  });

  it('oauth mode with no session is "Unauthenticated User"', () => {
    expect(resolveActor({ authMode: 'oauth' })).toBe('Unauthenticated User');
  });

  it('acn mode uses the agency user id', () => {
    expect(resolveActor({ authMode: 'acn', userId: 'agency-user-77' })).toBe(
      'agency-user-77'
    );
  });

  it('never returns an empty string for any mode', () => {
    const cases = [
      { authMode: 'none' as const },
      { authMode: 'simple' as const },
      { authMode: 'oauth' as const },
      { authMode: 'acn' as const, userId: 'x' },
    ];
    for (const c of cases) {
      expect(resolveActor(c).length).toBeGreaterThan(0);
    }
  });
});
