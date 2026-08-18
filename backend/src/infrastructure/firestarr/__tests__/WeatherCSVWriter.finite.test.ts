/**
 * WeatherCSVWriter — validateWeatherData must reject non-finite numbers
 *
 * Issue #350. Every comparison with NaN is false, so the range checks that
 * exist to catch invalid FWI values pass the one value that is definitely
 * invalid. On 2026-08-17 this wrote NaN into weather.csv on 271 of 282 rows,
 * validation passed, and FireSTARR segfaulted (exit 139).
 */

import { describe, it, expect } from 'vitest';
import { validateWeatherData } from '../WeatherCSVWriter.js';
import type { WeatherHourlyData } from '../types.js';

/** A fully valid hour. Callers override single fields to isolate one failure. */
function hour(overrides: Partial<WeatherHourlyData> = {}): WeatherHourlyData {
  return {
    date: new Date('2026-08-01T00:00:00Z'),
    temp: 24.4,
    rh: 46,
    ws: 10.2,
    wd: 222,
    precip: 0,
    ffmc: 81.66,
    dmc: 19.22,
    dc: 412.67,
    isi: 2,
    bui: 34.44,
    fwi: 4.64,
    ...overrides,
  };
}

/** Consecutive hours, so the hourly-gap check never fires and we isolate finiteness. */
function hours(...overrides: Array<Partial<WeatherHourlyData>>): WeatherHourlyData[] {
  const start = Date.UTC(2026, 7, 1, 0, 0, 0);
  return overrides.map((o, i) =>
    hour({ date: new Date(start + i * 3600_000), ...o })
  );
}

describe('validateWeatherData — non-finite values', () => {
  it('accepts fully valid finite data (guards against over-triggering)', () => {
    const result = validateWeatherData(hours({}, {}, {}));
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  const NUMERIC_FIELDS = [
    'temp', 'rh', 'ws', 'wd', 'precip',
    'ffmc', 'dmc', 'dc', 'isi', 'bui', 'fwi',
  ] as const;

  for (const field of NUMERIC_FIELDS) {
    it(`rejects NaN in ${field}`, () => {
      const result = validateWeatherData(hours({ [field]: NaN }));
      expect(result.valid).toBe(false);
      expect(result.issues.join(' ')).toContain(field);
    });

    it(`rejects Infinity in ${field}`, () => {
      const result = validateWeatherData(hours({ [field]: Infinity }));
      expect(result.valid).toBe(false);
      expect(result.issues.join(' ')).toContain(field);
    });

    it(`rejects -Infinity in ${field}`, () => {
      const result = validateWeatherData(hours({ [field]: -Infinity }));
      expect(result.valid).toBe(false);
      expect(result.issues.join(' ')).toContain(field);
    });
  }

  it("rejects vita's real failing row — valid observations, NaN indices", () => {
    // 0,2026-08-01 00:06:00,0,24.4,46,10.2,222,NaN,NaN,NaN,NaN,NaN,NaN
    const result = validateWeatherData(
      hours({
        ffmc: NaN, dmc: NaN, dc: NaN, isi: NaN, bui: NaN, fwi: NaN,
      })
    );

    expect(result.valid).toBe(false);
    // All six must be named — a person needs to know which columns are missing.
    for (const field of ['ffmc', 'dmc', 'dc', 'isi', 'bui', 'fwi']) {
      expect(result.issues.join(' ')).toContain(field);
    }
  });

  it('reports the row index so a person can find the bad row', () => {
    const result = validateWeatherData(hours({}, {}, { ffmc: NaN }));
    expect(result.valid).toBe(false);
    expect(result.issues.join(' ')).toContain('2');
  });
});
