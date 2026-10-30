/**
 * #482 half 2 — recovering the DAY, and only the day, for runs with no record.
 *
 * Franco's hail mary, and the reason it is allowed where the weather.csv
 * fallback was not. FireSTARR names its own outputs
 * `sizes_<julian>_<YYYY-MM-DD>.csv` — a calendar date the engine has ALREADY
 * PAIRED with the Julian day its rasters are keyed to. No zone, no local-time
 * parsing, no inference. The engine labelling its own output.
 *
 * The weather.csv fallback (#479) was impossible for a different reason: its
 * Date column is a BARE LOCAL timestamp whose declared zone lives in the very
 * config file whose absence triggers the fallback. A sizes filename carries no
 * time at all, so it has nothing to misinterpret.
 *
 * MEASURED BEFORE BUILDING, on the 194 real sizes files in
 * temp_firestarr_data/sims: the Julian in the name equals dayOfYear of the date
 * in the name in **194 of 194**, across four distinct years (2021, 2023, 2024,
 * 2025) — so it is not a single-year artefact. Both negative controls behaved:
 * `sizes_999_2023-06-19.csv` fails the consistency check, and `weather.csv`
 * does not parse.
 *
 * NOT RE-VERIFIED HERE, and recorded as such: the board's claim that the
 * earliest sizes Julian equals the earliest arrival Julian in all 13 cases. In
 * this sample NO directory has both arrival rasters and a config without a
 * timeRange, so the cross-check had zero cases to run on — it is the prior
 * session's measurement against a different sample, not something today
 * confirms.
 *
 * THE LIMIT THIS FILE ENFORCES. Day precision means there is NO time of day.
 * The returned value is a calendar date STRING and a precision marker, never a
 * Date — because a Date is an instant, and the only instant available would be
 * midnight, which is exactly the new invented value this issue exists to
 * prevent. `arrivalTimeSymbolization` computes a sub-day ignition fraction from
 * an instant; it must not be handed this.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readDerivedModelDate } from '../derivedModelDate.js';

describe('readDerivedModelDate', () => {
  let simDir: string;

  beforeEach(() => {
    simDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomad-482-derived-'));
  });

  afterEach(() => {
    fs.rmSync(simDir, { recursive: true, force: true });
  });

  function touch(name: string): void {
    fs.writeFileSync(path.join(simDir, name), 'Scenario,Size\n1,10\n');
  }

  describe('the controls', () => {
    it('returns undefined for an empty directory', async () => {
      expect(await readDerivedModelDate(simDir)).toBeUndefined();
    });

    it('does not read a date out of files that are not sizes files', async () => {
      // The negative control that matters: these names all contain dates or
      // digits, and none of them is the engine's own sizes output.
      touch('weather.csv');
      touch('output-config.json');
      touch('000_000001_170_arrival.tif');
      touch('sizes.csv');
      touch('sizes_170.csv');
      touch('sizes_2023-06-19.csv');
      // The prefix must be ANCHORED. Real sim dirs hold exactly two csv shapes
      // today — `sizes_<julian>_<date>.csv` (194 files) and `weather.csv` (69)
      // — so nothing would currently match an unanchored pattern. This file is
      // the control that keeps it that way: without it, dropping the `^sizes_`
      // anchor passes the whole suite.
      touch('perimeter_170_2023-06-19.csv');

      expect(await readDerivedModelDate(simDir)).toBeUndefined();
    });
  });

  it('recovers the calendar date from a single sizes file', async () => {
    touch('sizes_170_2023-06-19.csv');

    const derived = await readDerivedModelDate(simDir);

    expect(derived).toEqual({
      date: '2023-06-19',
      julianDay: 170,
      precision: 'day',
      source: 'sizes_170_2023-06-19.csv',
    });
  });

  it('takes the EARLIEST Julian day, not the first file read off disk', async () => {
    // Directory order is not sorted order, and 172 sorts before 99 as a string.
    // Written out of order on purpose.
    touch('sizes_172_2023-06-21.csv');
    touch('sizes_170_2023-06-19.csv');
    touch('sizes_171_2023-06-20.csv');

    const derived = await readDerivedModelDate(simDir);

    expect(derived?.julianDay).toBe(170);
    expect(derived?.date).toBe('2023-06-19');
  });

  it('compares Julian days NUMERICALLY, not as strings', async () => {
    // '100' < '99' as a string. A string comparison would pick day 100.
    touch('sizes_99_2023-04-09.csv');
    touch('sizes_100_2023-04-10.csv');

    const derived = await readDerivedModelDate(simDir);

    expect(derived?.julianDay).toBe(99);
    expect(derived?.date).toBe('2023-04-09');
  });

  it('REJECTS a file whose Julian day disagrees with its own date', async () => {
    // The engine paired these two values; if they disagree, the pairing is not
    // evidence of anything and recovering from it would be a guess. 194 of 194
    // real files agree, so a mismatch is anomalous, not routine.
    touch('sizes_999_2023-06-19.csv');

    expect(await readDerivedModelDate(simDir)).toBeUndefined();
  });

  it('skips an inconsistent file but still uses a consistent one', async () => {
    touch('sizes_999_2023-06-19.csv');
    touch('sizes_171_2023-06-20.csv');

    const derived = await readDerivedModelDate(simDir);

    expect(derived?.julianDay).toBe(171);
    expect(derived?.source).toBe('sizes_171_2023-06-20.csv');
  });

  it('handles a leap year — day 60 is Feb 29, not Mar 1', async () => {
    // 2024 is a leap year. A dayOfYear implementation that ignored leap days
    // would compute 60 for Mar 1 and reject the real Feb 29 file.
    touch('sizes_60_2024-02-29.csv');

    const derived = await readDerivedModelDate(simDir);

    expect(derived?.date).toBe('2024-02-29');
    expect(derived?.julianDay).toBe(60);
  });

  it('rejects Feb 29 in a non-leap year', async () => {
    // 2023-02-29 does not exist. A lenient parser would roll it to Mar 1 and
    // silently recover a date that was never written.
    touch('sizes_60_2023-02-29.csv');

    expect(await readDerivedModelDate(simDir)).toBeUndefined();
  });

  it('recovers day 1 and day 365 — the boundaries', async () => {
    touch('sizes_1_2021-01-01.csv');

    expect((await readDerivedModelDate(simDir))?.julianDay).toBe(1);

    fs.rmSync(path.join(simDir, 'sizes_1_2021-01-01.csv'));
    touch('sizes_365_2021-12-31.csv');

    const derived = await readDerivedModelDate(simDir);
    expect(derived?.julianDay).toBe(365);
    expect(derived?.date).toBe('2021-12-31');
  });

  it('returns a STRING date and a precision marker — never a Date', async () => {
    // The guard on the limit. A Date would be an instant, and the only instant
    // available is midnight, which is the invented value #482 is about. Asserted
    // so a later "convenience" change to return a Date fails here.
    touch('sizes_170_2023-06-19.csv');

    const derived = await readDerivedModelDate(simDir);

    expect(typeof derived?.date).toBe('string');
    expect(derived?.date).not.toMatch(/T|:|Z/);
    expect(derived?.precision).toBe('day');
    expect(derived && 'start' in derived).toBe(false);
    expect(derived && 'end' in derived).toBe(false);
  });

  it('names the file it read from, so a derived value is traceable', async () => {
    touch('sizes_170_2023-06-19.csv');

    expect((await readDerivedModelDate(simDir))?.source).toBe('sizes_170_2023-06-19.csv');
  });

  it('returns undefined for a directory that does not exist', async () => {
    expect(await readDerivedModelDate(path.join(simDir, 'nope'))).toBeUndefined();
  });
});
