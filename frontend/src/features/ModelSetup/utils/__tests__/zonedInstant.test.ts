/**
 * Zone-aware instant construction — issue #355.
 *
 * The wizard collects a date, a time, and an IANA timezone. Those three must
 * combine into one instant. Every existing site does `new Date("YYYY-MM-DDTHH:mm")`,
 * which JavaScript reads in the BROWSER's zone, so the declared timezone is
 * ignored and the same inputs produce different runs by operator location.
 *
 * No date library exists in this package, deliberately — these use Intl, the
 * same mechanism dateHelpers.ts already relies on.
 */

import { describe, it, expect } from 'vitest';
import { resolveZonedInstant } from '../zonedInstant.js';

describe('resolveZonedInstant', () => {
  it('resolves a summer mountain-daylight time to the right instant', () => {
    // 2026-08-04 12:00 MDT (UTC-6) === 18:00Z. Vita's ignition.
    const instant = resolveZonedInstant('2026-08-04', '12:00', 'America/Edmonton');
    expect(instant.toISOString()).toBe('2026-08-04T18:00:00.000Z');
  });

  it('resolves a winter mountain-standard time, offset and all', () => {
    // 2026-01-04 12:00 MST (UTC-7) === 19:00Z. The offset differs from summer,
    // which a fixed offset would get wrong half the year.
    const instant = resolveZonedInstant('2026-01-04', '12:00', 'America/Edmonton');
    expect(instant.toISOString()).toBe('2026-01-04T19:00:00.000Z');
  });

  it('handles a half-hour offset zone', () => {
    // Newfoundland daylight time is UTC-2:30.
    const instant = resolveZonedInstant('2026-08-04', '12:00', 'America/St_Johns');
    expect(instant.toISOString()).toBe('2026-08-04T14:30:00.000Z');
  });

  it('is the identity for UTC', () => {
    const instant = resolveZonedInstant('2026-08-04', '12:00', 'UTC');
    expect(instant.toISOString()).toBe('2026-08-04T12:00:00.000Z');
  });

  it('resolves an eastern-hemisphere zone', () => {
    // Tokyo is UTC+9 year round.
    const instant = resolveZonedInstant('2026-08-04', '12:00', 'Asia/Tokyo');
    expect(instant.toISOString()).toBe('2026-08-04T03:00:00.000Z');
  });

  it('produces different instants for the same wall clock in different zones', () => {
    // The whole point of #355: an Ontario duty officer and an NWT one entering
    // identical wizard values must get the fire's zone, not their own.
    const edmonton = resolveZonedInstant('2026-08-04', '12:00', 'America/Edmonton');
    const toronto = resolveZonedInstant('2026-08-04', '12:00', 'America/Toronto');

    expect(edmonton.getTime()).not.toBe(toronto.getTime());
    expect(edmonton.getTime() - toronto.getTime()).toBe(2 * 60 * 60 * 1000);
  });

  it('crosses a DST boundary correctly on the day the clocks go forward', () => {
    // 2026-03-08 is the US/Canada spring-forward date. 03:00 local is MDT.
    const instant = resolveZonedInstant('2026-03-08', '03:00', 'America/Edmonton');
    expect(instant.toISOString()).toBe('2026-03-08T09:00:00.000Z');
  });

  it('resolves a time on the day the clocks go back', () => {
    // 2026-11-01, fall-back. 12:00 local is MST (UTC-7) by midday.
    const instant = resolveZonedInstant('2026-11-01', '12:00', 'America/Edmonton');
    expect(instant.toISOString()).toBe('2026-11-01T19:00:00.000Z');
  });

  it('accepts a time with seconds', () => {
    const instant = resolveZonedInstant('2026-08-04', '12:30:45', 'UTC');
    expect(instant.toISOString()).toBe('2026-08-04T12:30:45.000Z');
  });

  it('defaults a missing time to midnight local', () => {
    const instant = resolveZonedInstant('2026-08-04', '', 'America/Edmonton');
    expect(instant.toISOString()).toBe('2026-08-04T06:00:00.000Z');
  });

  describe('fail-fast', () => {
    it('throws on an unknown timezone rather than silently using the browser zone', () => {
      expect(() => resolveZonedInstant('2026-08-04', '12:00', 'Mars/Olympus_Mons')).toThrow(/timezone/i);
    });

    it('throws on a malformed date', () => {
      expect(() => resolveZonedInstant('not-a-date', '12:00', 'UTC')).toThrow(/date/i);
    });

    it('throws on a malformed time', () => {
      expect(() => resolveZonedInstant('2026-08-04', '25:99', 'UTC')).toThrow(/time/i);
    });
  });
});
