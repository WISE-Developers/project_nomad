/**
 * FireSTARR weather input contract — issues #339, #340, #341.
 *
 * From FireSTARR's own source, quoted in #340:
 *
 *   if (12 == t.tm_hour) { auto& s_daily = wx_daily.at(cur); s_daily.emplace(day, ...); }
 *
 * Daily values are recorded ONLY on an exact hour-12 record. A day with no such
 * record never gets an entry, and the later lookup throws `FATAL: map::at` — ten
 * seconds in, with the reason only in the container log.
 *
 * Observed in production on the CIFFC demo 2026-08-19: four of six runs died
 * this way, every one of them with a weather series whose first day began after
 * noon (17:00 or 23:00).
 */

import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { validateFireStarrContract } from '../weatherContract.js';
import type { WeatherDataPoint } from '../../../application/interfaces/weather.js';

const ZONE = 'America/Edmonton';

function at(stamp: string): Date {
  return DateTime.fromSQL(stamp, { zone: ZONE }).toJSDate();
}

/** Hourly points across the given local hours of a day. */
function hours(day: string, from: number, to: number): WeatherDataPoint[] {
  const points: WeatherDataPoint[] = [];
  for (let h = from; h <= to; h++) {
    points.push({
      datetime: at(`${day} ${String(h).padStart(2, '0')}:00:00`),
      temperature: 20, humidity: 45, windSpeed: 10, windDirection: 180,
      precipitation: 0, ffmc: 85, dmc: 30, dc: 200, isi: 5, bui: 40, fwi: 10,
    });
  }
  return points;
}

const NOON = at('2026-08-04 12:00:00');

describe('validateFireStarrContract', () => {
  describe('the day-1 noon record (#340)', () => {
    it('accepts a series whose every day carries an hour-12 record', () => {
      const points = [...hours('2026-08-04', 0, 23), ...hours('2026-08-05', 0, 23)];
      expect(validateFireStarrContract(points, NOON, ZONE).valid).toBe(true);
    });

    it("rejects Danny's shape — a first day that begins after noon", () => {
      // The production failures: first day started at 17:00 or 23:00.
      const points = [...hours('2026-08-04', 17, 23), ...hours('2026-08-05', 0, 23)];
      const result = validateFireStarrContract(points, at('2026-08-05 12:00:00'), ZONE);

      expect(result.valid).toBe(false);
      expect(result.issues.join(' ')).toMatch(/2026-08-04/);
      expect(result.issues.join(' ')).toMatch(/noon|12:00/i);
    });

    it('rejects a series whose first day starts at 23:00', () => {
      const points = [...hours('2026-08-04', 23, 23), ...hours('2026-08-05', 0, 23)];
      expect(validateFireStarrContract(points, at('2026-08-05 12:00:00'), ZONE).valid).toBe(false);
    });

    it('rejects a MIDDLE day with no noon record — the lookup throws there too', () => {
      const points = [
        ...hours('2026-08-04', 0, 23),
        ...hours('2026-08-05', 13, 23),
        ...hours('2026-08-06', 0, 23),
      ];
      const result = validateFireStarrContract(points, NOON, ZONE);

      expect(result.valid).toBe(false);
      expect(result.issues.join(' ')).toMatch(/2026-08-05/);
    });

    it('names every offending day, not just the first', () => {
      const points = [
        ...hours('2026-08-04', 13, 23),
        ...hours('2026-08-05', 13, 23),
      ];
      const result = validateFireStarrContract(points, at('2026-08-04 13:00:00'), ZONE);

      expect(result.issues.join(' ')).toMatch(/2026-08-04/);
      expect(result.issues.join(' ')).toMatch(/2026-08-05/);
    });

    it('requires hour 12 exactly — 12:30 is not a noon record to FireSTARR', () => {
      // tm_hour == 12 is the test in the engine, so :30 still satisfies it,
      // but 13:00 does not. This pins that we match on the HOUR.
      const half = hours('2026-08-04', 0, 23).map((p) =>
        DateTime.fromJSDate(p.datetime, { zone: ZONE }).hour === 12
          ? { ...p, datetime: at('2026-08-04 12:30:00') }
          : p,
      );
      // Ignition at 13:00, after the 12:30 record, so this isolates the HOUR
      // rule instead of also tripping the ignition-window rule.
      expect(validateFireStarrContract(half, at('2026-08-04 13:00:00'), ZONE).valid).toBe(true);
    });
  });

  describe('the ignition window (#341)', () => {
    const twoDays = [...hours('2026-08-04', 0, 23), ...hours('2026-08-05', 0, 23)];

    it('accepts an ignition exactly at the day-1 noon record', () => {
      expect(validateFireStarrContract(twoDays, NOON, ZONE).valid).toBe(true);
    });

    it('accepts an ignition after noon', () => {
      expect(validateFireStarrContract(twoDays, at('2026-08-04 15:00:00'), ZONE).valid).toBe(true);
    });

    it('rejects an ignition BEFORE the day-1 noon record', () => {
      // 09:00 Monday with the first CFFDRS at noon: the fire starts before any
      // codes exist for that day, so the codes supplied are never applied.
      const result = validateFireStarrContract(twoDays, at('2026-08-04 09:00:00'), ZONE);

      expect(result.valid).toBe(false);
      expect(result.issues.join(' ')).toMatch(/ignition/i);
    });

    it('rejects an ignition after the weather series ends', () => {
      const result = validateFireStarrContract(twoDays, at('2026-08-09 12:00:00'), ZONE);

      expect(result.valid).toBe(false);
      expect(result.issues.join(' ')).toMatch(/ignition/i);
    });

    it('says what the usable window actually is, so the user can fix it', () => {
      const result = validateFireStarrContract(twoDays, at('2026-08-04 09:00:00'), ZONE);
      expect(result.issues.join(' ')).toMatch(/2026-08-04 12:00/);
    });
  });

  describe('degenerate input', () => {
    it('rejects an empty series', () => {
      const result = validateFireStarrContract([], NOON, ZONE);
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it('reports every problem at once rather than one per attempt', () => {
      // A first day with no noon AND an ignition outside the window.
      const points = hours('2026-08-04', 17, 23);
      const result = validateFireStarrContract(points, at('2026-08-01 09:00:00'), ZONE);

      expect(result.issues.length).toBeGreaterThanOrEqual(2);
    });
  });
});
