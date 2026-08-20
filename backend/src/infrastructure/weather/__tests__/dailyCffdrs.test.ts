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
import { DateTime } from 'luxon';
import {
  hasDailyOnlyCffdrs,
  findStartingCodeCandidate,
  describeDailyRhythm,
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

/**
 * Builds a row the way the parse path really builds one.
 *
 * WeatherService reads the CSV Date column with parseTimestampInZone
 * (WeatherService.ts:23), which is DateTime.fromSQL(raw, { zone }) — the naive
 * timestamp is interpreted IN the model timezone. So a row written
 * "2026-08-01 19:06:00" reads back as local hour 19, whatever the zone is.
 *
 * The earlier fixture here built genuine UTC instants and so tested a shape the
 * parser never produces. See #354 for the underlying contract gap.
 */
function row(csvTimestamp: string, codes?: [number, number, number]): CffdrsRow {
  const [ffmc, dmc, dc] = codes ?? [NaN, NaN, NaN];
  return {
    datetime: DateTime.fromSQL(csvTimestamp, { zone: ZONE }).toJSDate(),
    ffmc,
    dmc,
    dc,
  };
}

/** An instant from a naive local timestamp, as the request's timeRange.start arrives. */
function localInstant(csvTimestamp: string, zone: string = ZONE): Date {
  return DateTime.fromSQL(csvTimestamp, { zone }).toJSDate();
}

/** Vita's file, reduced to the rows that matter — as parsed, not as idealised. */
function vitasRows(): CffdrsRow[] {
  return [
    row('2026-08-01 00:06:00'),
    row('2026-08-01 19:06:00', [81.66, 19.22, 412.67]),
    row('2026-08-02 00:06:00'),
    row('2026-08-02 19:06:00', [76.3, 18.52, 418.6]),
    row('2026-08-03 00:06:00'),
    row('2026-08-03 19:06:00', [84.65, 20.72, 424.9]),
    row('2026-08-04 00:06:00'),
    row('2026-08-04 19:06:00', [88.44, 23.66, 432.05]),
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
  // Her ignition: 2026-08-04 12:00 local.
  const ignition = localInstant('2026-08-04 12:00:00');

  it("returns Aug 3's codes for vita's Aug 4 noon ignition, NOT Aug 4's", () => {
    const found = findStartingCodeCandidate(vitasRows(), ignition, ZONE);

    expect(found).not.toBeNull();
    expect(found!.ffmc).toBe(84.65);
    expect(found!.dmc).toBe(20.72);
    expect(found!.dc).toBe(424.9);
    expect(found!.observedAt).toEqual(localInstant('2026-08-03 19:06:00'));
  });

  it('derives the daily hour from the file rather than assuming noon', () => {
    // Nothing here sits at hour 12 or 13. The file's own rhythm is hour 19,
    // and that is what makes these rows the daily readings.
    const found = findStartingCodeCandidate(vitasRows(), ignition, ZONE);
    expect(found!.ffmc).toBe(84.65);
  });

  it('works at any consistent hour — a station that writes its daily at 09:00', () => {
    const rows = [
      row('2026-08-01 09:00:00', [81.66, 19.22, 412.67]),
      row('2026-08-02 03:00:00'),
      row('2026-08-02 09:00:00', [84.65, 20.72, 424.9]),
    ];
    const found = findStartingCodeCandidate(rows, ignition, ZONE);
    expect(found!.ffmc).toBe(84.65);
  });

  it('ignores a stray coded row that is off the file rhythm', () => {
    // Four readings at hour 19 establish the rhythm. One row at 09:06 carries
    // codes but is not the daily reading, and must not be offered.
    const rows = [
      ...vitasRows(),
      row('2026-08-03 09:06:00', [99.9, 99.9, 99.9]),
    ];
    const found = findStartingCodeCandidate(rows, ignition, ZONE);
    expect(found!.ffmc).toBe(84.65);
  });

  it('labels the reading in local time for a human to recognise', () => {
    const found = findStartingCodeCandidate(vitasRows(), ignition, ZONE);
    expect(found!.localLabel).toBe('2026-08-03, 1900');
  });

  it('ignores minutes entirely — stations poll at :00, :05, :06, :30', () => {
    for (const minute of ['00', '05', '06', '30', '59']) {
      const rows = [row(`2026-08-03 19:${minute}:00`, [84.65, 20.72, 424.9])];
      const found = findStartingCodeCandidate(rows, ignition, ZONE);
      expect(found, `minute :${minute} should match`).not.toBeNull();
      expect(found!.ffmc).toBe(84.65);
    }
  });

  it('takes the LAST daily reading before ignition, not the first', () => {
    const found = findStartingCodeCandidate(vitasRows(), ignition, ZONE);
    expect(found!.ffmc).toBe(84.65); // Aug 3, not Aug 1's 81.66
  });

  it('excludes a daily reading exactly at ignition — strictly before', () => {
    // A single row, so nothing earlier can be returned instead. This isolates
    // the boundary: the row is on rhythm and carries codes, and is rejected
    // solely for being at ignition rather than before it.
    const at = localInstant('2026-08-03 19:06:00');
    const rows = [row('2026-08-03 19:06:00', [84.65, 20.72, 424.9])];
    expect(findStartingCodeCandidate(rows, at, ZONE)).toBeNull();
  });

  it('returns null when no daily reading precedes ignition', () => {
    const early = localInstant('2026-08-01 12:00:00');
    expect(findStartingCodeCandidate(vitasRows(), early, ZONE)).toBeNull();
  });

  it('returns null when no row carries codes at all', () => {
    const rows = [row('2026-08-01 19:06:00'), row('2026-08-02 19:06:00')];
    expect(findStartingCodeCandidate(rows, ignition, ZONE)).toBeNull();
  });

  it('skips rows on the rhythm whose codes are missing', () => {
    const rows = [
      row('2026-08-01 19:06:00', [81.66, 19.22, 412.67]),
      row('2026-08-03 19:06:00'), // on rhythm, no codes — not usable
    ];
    const found = findStartingCodeCandidate(rows, ignition, ZONE);
    expect(found!.ffmc).toBe(81.66);
  });

  it('labels in the supplied zone — the label moves, the reading does not', () => {
    // Detection no longer depends on the zone: every row shifts together, so
    // the rhythm survives. Only the human-facing label is zone-dependent.
    const found = findStartingCodeCandidate(vitasRows(), ignition, 'Asia/Tokyo');
    expect(found).not.toBeNull();
    expect(found!.ffmc).toBe(84.65);
    expect(found!.localLabel).toBe('2026-08-04, 1000');
  });
});

describe('describeDailyRhythm', () => {
  // The contract (#354): the CSV Date column is LOCAL time in the model's
  // timezone. Daily CFFDRS codes are calculated at noon LST, which is local
  // hour 12, or 13 under daylight time. A file whose daily readings sit
  // elsewhere is telling us its timestamps are not on the clock we were told.

  it('reports a conforming file as on-contract', () => {
    const rows = [
      row('2026-08-01 13:00:00', [81.66, 19.22, 412.67]),
      row('2026-08-02 03:00:00'),
      row('2026-08-02 13:00:00', [84.65, 20.72, 424.9]),
    ];
    const rhythm = describeDailyRhythm(rows, ZONE);

    expect(rhythm!.dailyHour).toBe(13);
    expect(rhythm!.likelyZoneMismatch).toBe(false);
    expect(rhythm!.hoursFromNoon).toBe(0);
  });

  it('accepts local hour 12 — standard time rather than daylight time', () => {
    const rows = [row('2026-08-01 12:00:00', [81.66, 19.22, 412.67])];
    const rhythm = describeDailyRhythm(rows, ZONE);

    expect(rhythm!.likelyZoneMismatch).toBe(false);
    expect(rhythm!.hoursFromNoon).toBe(0);
  });

  it("measures vita's file as six hours ahead of contract", () => {
    // Her daily rows read 19:06. Declared zone is America/Edmonton, MDT, UTC-6.
    // Six hours ahead of noon is exactly UTC — which is what her file is.
    const rhythm = describeDailyRhythm(vitasRows(), ZONE);

    expect(rhythm!.dailyHour).toBe(19);
    expect(rhythm!.likelyZoneMismatch).toBe(true);
    expect(rhythm!.hoursFromNoon).toBe(6);
  });

  it('reports a negative offset for a file behind the declared zone', () => {
    const rows = [row('2026-08-01 09:00:00', [81.66, 19.22, 412.67])];
    const rhythm = describeDailyRhythm(rows, ZONE);

    expect(rhythm!.hoursFromNoon).toBe(-3);
    expect(rhythm!.likelyZoneMismatch).toBe(true);
  });

  it('wraps around midnight rather than measuring the long way', () => {
    // 01:00 is eleven hours BEFORE noon, not thirteen hours after it.
    const rows = [row('2026-08-01 01:00:00', [81.66, 19.22, 412.67])];
    const rhythm = describeDailyRhythm(rows, ZONE);

    expect(rhythm!.hoursFromNoon).toBe(-11);
    expect(rhythm!.likelyZoneMismatch).toBe(true);
  });

  it('returns null when no row carries codes — nothing to measure', () => {
    expect(describeDailyRhythm([row('2026-08-01 13:00:00')], ZONE)).toBeNull();
  });
});

describe('invalid timezone (#353)', () => {
  // Luxon returns an INVALID DateTime for an unrecognised zone rather than
  // throwing, so local.hour is NaN, no row matches, and the caller receives the
  // same null it gets for "this file has no usable reading". A configuration
  // error and a legitimate absence must not look identical.

  it('throws rather than reporting no candidate', () => {
    expect(() =>
      findStartingCodeCandidate(vitasRows(), localInstant('2026-08-04 12:00:00'), 'Mars/Olympus_Mons'),
    ).toThrow(/timezone/i);
  });

  it('names the offending value', () => {
    expect(() =>
      findStartingCodeCandidate(vitasRows(), localInstant('2026-08-04 12:00:00'), 'Not/AZone'),
    ).toThrow(/Not\/AZone/);
  });

  it('throws for an empty timezone too', () => {
    expect(() =>
      findStartingCodeCandidate(vitasRows(), localInstant('2026-08-04 12:00:00'), ''),
    ).toThrow(/timezone/i);
  });

  it('throws from describeDailyRhythm as well', () => {
    expect(() => describeDailyRhythm(vitasRows(), 'Mars/Olympus_Mons')).toThrow(/timezone/i);
  });

  it('still accepts every real zone it is given', () => {
    for (const zone of ['America/Edmonton', 'America/St_Johns', 'UTC', 'Asia/Tokyo']) {
      expect(() =>
        findStartingCodeCandidate(vitasRows(), localInstant('2026-08-04 12:00:00'), zone),
      ).not.toThrow();
    }
  });
});
