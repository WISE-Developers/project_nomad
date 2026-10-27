import { describe, it, expect } from 'vitest';
import {
  timeOffsetHoursForJulianDay,
  dayOfYear,
  resolveSeriesStartJulian,
} from '../julianTimeOffset.js';

/**
 * The formula was written twice in ModelResultsService: once correctly for
 * deterministic perimeters, and once as `julianDay * 24` for stored outputs —
 * which is year-anchored, so 19 June came out as 4080 hours from the model's
 * start. That value was replaced with null rather than fixed (TODO #236-followup),
 * which is why the per-day probability rasters carry no time coordinate at all.
 */
describe('timeOffsetHoursForJulianDay', () => {
  it('measures hours from the model start, not from the start of the year', () => {
    // Run c7ea0072 starts on Julian day 170 and writes days 170..176.
    expect(timeOffsetHoursForJulianDay(170, 170)).toBe(0);
    expect(timeOffsetHoursForJulianDay(171, 170)).toBe(24);
    expect(timeOffsetHoursForJulianDay(176, 170)).toBe(144);
  });

  it('is NOT the year-anchored value the old code produced', () => {
    // 170 * 24 = 4080, which is what the removed line computed for day one.
    expect(timeOffsetHoursForJulianDay(170, 170)).not.toBe(4080);
  });

  it('returns null when the start day is unknown, never a confident wrong number', () => {
    // An unknown start stays unknown: modelStartDate deliberately returns
    // undefined rather than today, and this must not turn that into zero.
    expect(timeOffsetHoursForJulianDay(176, null)).toBeNull();
    expect(timeOffsetHoursForJulianDay(176, undefined)).toBeNull();
  });

  it('returns null when the Julian day is unknown', () => {
    expect(timeOffsetHoursForJulianDay(null, 170)).toBeNull();
    expect(timeOffsetHoursForJulianDay(undefined, 170)).toBeNull();
  });

  it('handles a run that crosses a year boundary rather than going negative', () => {
    // Day 3 of a run that began on day 364. A negative offset would sort the
    // series backwards and is never a real result.
    expect(timeOffsetHoursForJulianDay(3, 364)).toBe(96);
  });

  it('still returns 0 for the start day of a year-crossing run', () => {
    expect(timeOffsetHoursForJulianDay(364, 364)).toBe(0);
  });
});

describe('dayOfYear', () => {
  it('is 1-indexed and matches FireSTARR filename days', () => {
    // probability_170_2023-06-19.tif — day 170 is 19 June 2023.
    expect(dayOfYear(new Date('2023-06-19T00:00:00Z'))).toBe(170);
    expect(dayOfYear(new Date('2023-01-01T00:00:00Z'))).toBe(1);
    expect(dayOfYear(new Date('2023-12-31T00:00:00Z'))).toBe(365);
  });

  it('counts 29 February in a leap year', () => {
    expect(dayOfYear(new Date('2024-02-29T00:00:00Z'))).toBe(60);
    expect(dayOfYear(new Date('2024-12-31T00:00:00Z'))).toBe(366);
  });

  it('is computed in UTC, so a late-evening local time does not slip a day', () => {
    // 19 June 23:00 UTC is still day 170, not 171.
    expect(dayOfYear(new Date('2023-06-19T23:00:00Z'))).toBe(170);
  });
});

describe('resolveSeriesStartJulian', () => {
  it('prefers the model start date when one is recorded', () => {
    // config timeRange.start carries an offset and parses strictly.
    expect(
      resolveSeriesStartJulian([172, 176, 170], new Date('2023-06-19T00:00:00Z')),
    ).toBe(170);
  });

  it('falls back to the EARLIEST day in the series when no start date exists', () => {
    // Every real FireSTARR weather.csv states its datetime without a zone, and
    // the codebase refuses bare timestamps (#273). The series' own first day is
    // the only zone-free reference available, and it needs no parsing.
    expect(resolveSeriesStartJulian([172, 176, 170], undefined)).toBe(170);
  });

  it('ignores the order the days arrive in', () => {
    expect(resolveSeriesStartJulian([176, 170, 173], undefined)).toBe(170);
  });

  it('returns null for an empty series rather than zero', () => {
    expect(resolveSeriesStartJulian([], undefined)).toBeNull();
  });

  it('does not let a recorded start date be overridden by a later first output', () => {
    // A run whose first OUTPUT day is day 2 still started on day 1.
    expect(
      resolveSeriesStartJulian([171, 172], new Date('2023-06-19T00:00:00Z')),
    ).toBe(170);
  });
});
