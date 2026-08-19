/**
 * Bounded weather validation reporting — issue #342.
 *
 * A real failure on the CIFFC demo produced a 355 KB error containing 5,928
 * issues, one line per observation pair, written to jobs.error and shipped to
 * the browser. The validation was correct; the reporting destroyed its value.
 *
 * The underlying problem was one sentence long — the file is daily observations
 * in reverse chronological order — and that conclusion was derivable from the
 * distribution of the gaps. Nobody reads to line 5,928.
 */

import { describe, it, expect } from 'vitest';
import { validateWeatherData } from '../WeatherCSVWriter.js';
import type { WeatherHourlyData } from '../types.js';

const BASE = new Date('2026-08-04T12:00:00Z').getTime();
const HOUR = 60 * 60 * 1000;

function point(offsetHours: number, overrides: Partial<WeatherHourlyData> = {}): WeatherHourlyData {
  return {
    date: new Date(BASE + offsetHours * HOUR),
    temp: 20, rh: 45, ws: 10, wd: 180, precip: 0,
    ffmc: 85, dmc: 30, dc: 200, isi: 5, bui: 40, fwi: 10,
    ...overrides,
  } as WeatherHourlyData;
}

/** Hourly ascending — the shape FireSTARR requires. */
function hourly(count: number): WeatherHourlyData[] {
  return Array.from({ length: count }, (_, i) => point(i));
}

/** Daily observations in reverse chronological order — the demo failure. */
function dailyDescending(count: number): WeatherHourlyData[] {
  return Array.from({ length: count }, (_, i) => point(-24 * i));
}

describe('validateWeatherData reporting is bounded (#342)', () => {
  it('still accepts correct data', () => {
    const result = validateWeatherData(hourly(48));
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  describe('the demo failure: 5,928 gap issues', () => {
    const result = validateWeatherData(dailyDescending(3000));

    it('is still reported as invalid', () => {
      expect(result.valid).toBe(false);
    });

    it('produces a handful of issues, not one per observation pair', () => {
      expect(result.issues.length).toBeLessThanOrEqual(5);
    });

    it('produces a message small enough to store and transport', () => {
      // 355 KB went into jobs.error and over the API. This must be orders of
      // magnitude smaller regardless of how broken the file is.
      expect(result.issues.join(' ').length).toBeLessThan(2000);
    });

    it('states how many observations are affected', () => {
      expect(result.issues.join(' ')).toMatch(/2999|2,999/);
    });

    it('names the dominant gap instead of repeating it 2,999 times', () => {
      expect(result.issues.join(' ')).toMatch(/-24/);
    });

    it('draws the conclusion the user needs — reverse chronological order', () => {
      // The insight was always derivable. Now it is stated.
      expect(result.issues.join(' ')).toMatch(/reverse|descending|newest first/i);
    });
  });

  it('summarises a mixture of gaps with counts rather than listing each', () => {
    // Ascending but with holes: a few 2-hour and 3-hour jumps.
    const points = [point(0), point(1), point(3), point(4), point(7), point(8), point(10)];
    const result = validateWeatherData(points);

    expect(result.issues.length).toBeLessThanOrEqual(3);
    expect(result.issues.join(' ')).toMatch(/gap/i);
  });

  it('groups non-finite values by field instead of one issue per row', () => {
    const points = hourly(500).map((p) => ({ ...p, ffmc: NaN, dmc: NaN }));
    const result = validateWeatherData(points);

    expect(result.valid).toBe(false);
    // Two fields affected — two issues, not a thousand.
    expect(result.issues.length).toBeLessThanOrEqual(4);
    expect(result.issues.join(' ')).toMatch(/500/);
    expect(result.issues.join(' ')).toMatch(/ffmc/);
    expect(result.issues.join(' ')).toMatch(/dmc/);
  });

  it('gives example row numbers so the user can go and look', () => {
    const points = hourly(100).map((p, i) => (i === 7 ? { ...p, rh: 250 } : p));
    const result = validateWeatherData(points);

    expect(result.issues.join(' ')).toMatch(/\b7\b/);
  });

  it('groups out-of-range values by field too', () => {
    const points = hourly(300).map((p) => ({ ...p, rh: 250 }));
    const result = validateWeatherData(points);

    expect(result.issues.length).toBeLessThanOrEqual(3);
    expect(result.issues.join(' ')).toMatch(/300/);
  });

  it('stays bounded when everything is wrong at once', () => {
    const points = dailyDescending(2000).map((p) => ({ ...p, ffmc: NaN, rh: -5, ws: -1 }));
    const result = validateWeatherData(points);

    expect(result.issues.join(' ').length).toBeLessThan(3000);
  });
});
