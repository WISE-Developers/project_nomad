/**
 * Daily-only CFFDRS detection and starting-code recovery — issue #351.
 *
 * Built from vita's real file. Hourly station observations from a station that
 * writes at :06, with the CFFDRS indices recorded once per day at 19:06 UTC —
 * 13:06 MDT, which is noon LST. Six upload attempts over a week, all segfaults.
 *
 * The eleven daily readings in her file begin:
 *   2026-08-01 19:06   FFMC 81.66  DMC 19.22  DC 412.67
 *   2026-08-02 19:06   FFMC 76.30  DMC 18.52  DC 418.60
 *   2026-08-03 19:06   FFMC 84.65  DMC 20.72  DC 424.90
 *   2026-08-04 19:06   FFMC 88.44  DMC 23.66  DC 432.05
 *
 * Her ignition is 2026-08-04 12:00 local. The 08-04 daily row is hour 13 —
 * an hour too late. The correct answer is 08-03's codes.
 */

import { describe, it, expect } from 'vitest';
import {
  hasDailyOnlyCffdrs,
  findStartingCodeCandidate,
  type CffdrsRow,
} from '../dailyCffdrs.js';

const ZONE = 'America/Edmonton'; // MDT in August = UTC-6

/** A row with no codes — every non-noon row in her file. */
function blank(iso: string): CffdrsRow {
  return { datetime: new Date(iso), ffmc: NaN, dmc: NaN, dc: NaN };
}

/** A row carrying a daily reading. */
function daily(
  iso: string,
  ffmc: number,
  dmc: number,
  dc: number,
): CffdrsRow {
  return { datetime: new Date(iso), ffmc, dmc, dc };
}

/** Vita's file, reduced to the rows that matter. */
function vitasRows(): CffdrsRow[] {
  return [
    blank('2026-08-01T06:06:00Z'), // 00:06 local
    daily('2026-08-01T19:06:00Z', 81.66, 19.22, 412.67),
    blank('2026-08-02T06:06:00Z'),
    daily('2026-08-02T19:06:00Z', 76.3, 18.52, 418.6),
    blank('2026-08-03T06:06:00Z'),
    daily('2026-08-03T19:06:00Z', 84.65, 20.72, 424.9),
    blank('2026-08-04T06:06:00Z'),
    daily('2026-08-04T19:06:00Z', 88.44, 23.66, 432.05),
  ];
}

describe('hasDailyOnlyCffdrs', () => {
  it("detects the shape in vita's file", () => {
    expect(hasDailyOnlyCffdrs(vitasRows())).toBe(true);
  });

  it('is false when every row carries codes (a conforming firestarr_csv)', () => {
    const rows = [
      daily('2026-08-01T06:06:00Z', 81.66, 19.22, 412.67),
      daily('2026-08-01T07:06:00Z', 81.7, 19.3, 412.8),
    ];
    expect(hasDailyOnlyCffdrs(rows)).toBe(false);
  });

  it('is false when NO row carries codes — nothing to recover', () => {
    // A different failure. There are no codes to offer, so this must not be
    // reported as the recoverable daily-only shape.
    const rows = [blank('2026-08-01T06:06:00Z'), blank('2026-08-01T07:06:00Z')];
    expect(hasDailyOnlyCffdrs(rows)).toBe(false);
  });

  it('is false for an empty file', () => {
    expect(hasDailyOnlyCffdrs([])).toBe(false);
  });

  it('treats a partially-populated row as missing codes', () => {
    // FFMC present but DMC/DC absent is not a usable daily reading.
    const rows = [
      { datetime: new Date('2026-08-01T19:06:00Z'), ffmc: 84.65, dmc: NaN, dc: NaN },
      blank('2026-08-01T20:06:00Z'),
    ];
    expect(hasDailyOnlyCffdrs(rows)).toBe(false);
  });
});

describe('findStartingCodeCandidate', () => {
  const ignition = new Date('2026-08-04T18:00:00Z'); // 12:00 local MDT

  it("returns Aug 3's codes for vita's Aug 4 noon ignition, NOT Aug 4's", () => {
    const found = findStartingCodeCandidate(vitasRows(), ignition, ZONE);

    expect(found).not.toBeNull();
    expect(found!.ffmc).toBe(84.65);
    expect(found!.dmc).toBe(20.72);
    expect(found!.dc).toBe(424.9);
    expect(found!.observedAt.toISOString()).toBe('2026-08-03T19:06:00.000Z');
  });

  it('labels the reading in local time for a human to recognise', () => {
    const found = findStartingCodeCandidate(vitasRows(), ignition, ZONE);
    expect(found!.localLabel).toBe('2026-08-03, 1300');
  });

  it('matches on local hour and ignores minutes entirely', () => {
    // Stations write at :00, :05, :06, :10 depending on polling. All are the
    // same daily reading.
    for (const minute of ['00', '05', '06', '30', '59']) {
      const rows = [daily(`2026-08-03T19:${minute}:00Z`, 84.65, 20.72, 424.9)];
      const found = findStartingCodeCandidate(rows, ignition, ZONE);
      expect(found, `minute :${minute} should match`).not.toBeNull();
      expect(found!.ffmc).toBe(84.65);
    }
  });

  it('accepts local hour 12 as well as 13 (standard time vs daylight time)', () => {
    // 18:06Z = 12:06 MDT
    const rows = [daily('2026-08-03T18:06:00Z', 84.65, 20.72, 424.9)];
    const found = findStartingCodeCandidate(rows, ignition, ZONE);
    expect(found).not.toBeNull();
    expect(found!.ffmc).toBe(84.65);
  });

  it('ignores a populated row that is not at a daily hour', () => {
    // 15:06Z = 09:06 local. Carries codes, but it is not the daily reading.
    const rows = [daily('2026-08-03T15:06:00Z', 99.9, 99.9, 99.9)];
    expect(findStartingCodeCandidate(rows, ignition, ZONE)).toBeNull();
  });

  it('takes the LAST daily reading before ignition, not the first', () => {
    const found = findStartingCodeCandidate(vitasRows(), ignition, ZONE);
    expect(found!.ffmc).toBe(84.65); // Aug 3, not Aug 1's 81.66
  });

  it('excludes a daily reading exactly at ignition — strictly before', () => {
    const atIgnition = new Date('2026-08-03T19:06:00Z');
    expect(findStartingCodeCandidate(vitasRows(), atIgnition, ZONE)).toBeNull();
  });

  it('returns null when no daily reading precedes ignition', () => {
    const earlyIgnition = new Date('2026-08-01T12:00:00Z');
    expect(findStartingCodeCandidate(vitasRows(), earlyIgnition, ZONE)).toBeNull();
  });

  it('skips daily-hour rows whose codes are missing', () => {
    const rows = [
      daily('2026-08-01T19:06:00Z', 81.66, 19.22, 412.67),
      blank('2026-08-03T19:06:00Z'), // daily hour, no codes — not usable
    ];
    const found = findStartingCodeCandidate(rows, ignition, ZONE);
    expect(found!.ffmc).toBe(81.66);
  });

  it('resolves the daily hour in the supplied zone, not the server zone', () => {
    // The same instants read in Asia/Tokyo are not local noon, so nothing matches.
    const found = findStartingCodeCandidate(vitasRows(), ignition, 'Asia/Tokyo');
    expect(found).toBeNull();
  });
});
