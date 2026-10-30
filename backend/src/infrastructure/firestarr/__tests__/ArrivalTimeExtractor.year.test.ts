/**
 * #492 — a perimeter is never NAMED with a year nothing recorded.
 *
 * #482 removed the invented start date from `modelStartDate` and the arrival
 * output. This file had its own copy and it survived, because I enumerated the
 * surfaces that CONSUME a start date and called that the class. The real class
 * is the places that DERIVE one, and this module derives its own, from a
 * different source, one layer down.
 *
 * TWO SOURCES, BOTH MEASURED on the running app before this was written:
 *
 *   1. `weather.csv` — a `(\d{4})-\d{2}-\d{2}` regex against line 2. Moving the
 *      weather year 2023 -> 1999 moved the perimeter names to 1999, which is
 *      how it was proven rather than argued. This is the fallback #479
 *      established CANNOT be correct: that Date column is a bare LOCAL
 *      timestamp whose declared zone lives in the config file whose absence is
 *      what puts us in this branch.
 *
 *   2. `startYear ?? new Date().getFullYear()` — with `weather.csv` removed the
 *      perimeters read "Fire Boundary - 2026-06-19" for a 2023 fire. #482's
 *      defect verbatim.
 *
 * It bites harder than the one already fixed, because there it was metadata and
 * here it is the output NAME — the string in Model Outputs, on the downloaded
 * GeoJSON's layer, and in the exported bundle, with nothing marking it derived.
 *
 * THE RULE: a year comes from the model or it does not exist. No file is
 * sniffed for one, and today is never substituted.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { julianDayToDate } from '../ArrivalTimeExtractor.js';

describe('julianDayToDate', () => {
  describe('with a known year it still produces real dates', () => {
    it('day 170 of 2023 is June 19', () => {
      expect(julianDayToDate(170, 2023)).toBe('2023-06-19');
    });

    it('day 1 is January 1', () => {
      expect(julianDayToDate(1, 2023)).toBe('2023-01-01');
    });

    it('day 365 of a non-leap year is December 31', () => {
      expect(julianDayToDate(365, 2023)).toBe('2023-12-31');
    });

    it('handles a leap year — day 60 of 2024 is February 29', () => {
      expect(julianDayToDate(60, 2024)).toBe('2024-02-29');
    });

    it('day 60 of a NON-leap year is March 1 — the control for the leap case', () => {
      // Without this pair, a leap-day bug could hide: both tests pass only if
      // the conversion is actually calendar-aware rather than day-170-offset
      // arithmetic.
      expect(julianDayToDate(60, 2023)).toBe('2023-03-01');
    });
  });

  describe('with NO year, there is no date — today is never substituted', () => {
    it('returns null when the year is undefined', () => {
      expect(julianDayToDate(170, undefined)).toBeNull();
    });

    it('never returns a date containing the current year', () => {
      // The discriminating assertion, and the exact regression. The old code
      // produced `new Date().getFullYear()` here, so a 2023 reconstruction was
      // named with today's year.
      const thisYear = String(new Date().getUTCFullYear());

      const result = julianDayToDate(170, undefined);

      expect(result).toBeNull();
      expect(result ?? '').not.toContain(thisYear);
    });

    it('returns null for every day of the year when the year is unknown', () => {
      for (const day of [1, 60, 170, 200, 365]) {
        expect(julianDayToDate(day, undefined)).toBeNull();
      }
    });
  });
});

describe('#492 — the extractor derives a year from nothing on disk', () => {
  /**
   * A source-level guard, and it is deliberate rather than lazy.
   *
   * The behavioural path through `extractDeterministicPerimeters` needs GDAL
   * and real rasters, so it cannot run here. But the defect was never in the
   * arithmetic — it was that this module went LOOKING for a year, in a file
   * that cannot supply a correct one. "Does this module read weather.csv" is
   * exactly the proposition, and it is answerable from the source.
   *
   * Same shape as `migrationsRegistered.convention.test.ts` and
   * `noBareNewDate.convention.test.ts`, both already in this codebase.
   */
  const SOURCE = join(__dirname, '..', 'ArrivalTimeExtractor.ts');

  function sourceWithoutComments(): string {
    const raw = readFileSync(SOURCE, 'utf8');
    return raw
      .split('\n')
      .filter((l: string) => {
        const t = l.trim();
        return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
      })
      .join('\n');
  }

  describe('the controls', () => {
    it('actually reads the module — an empty read would pass everything', () => {
      const src = sourceWithoutComments();
      expect(src.length).toBeGreaterThan(500);
      expect(src).toContain('extractDeterministicPerimeters');
    });

    it('goes RED for a string that is genuinely absent', () => {
      expect(sourceWithoutComments()).not.toContain('aStringNobodyWrote492');
    });
  });

  it('does not read weather.csv for a year', () => {
    // #479: that Date column is a bare LOCAL timestamp and the zone needed to
    // read it lives in the very file whose absence triggers the fallback.
    expect(sourceWithoutComments()).not.toContain('weather.csv');
  });

  it('does not substitute the current year', () => {
    expect(sourceWithoutComments()).not.toContain('getFullYear');
  });
});
