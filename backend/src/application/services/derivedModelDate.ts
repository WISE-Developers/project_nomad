/**
 * Recovering the DAY a model was simulated for, when nothing recorded it (#482).
 *
 * For runs created from migration 009 onward the range is a property of the
 * model and none of this is needed. This module exists for the runs that
 * predate the column, whose configs carry only
 * `confidenceInterval`/`outputMode`/`smoothPerimeter` and no `timeRange` at all.
 *
 * WHY THIS SOURCE IS ALLOWED WHERE weather.csv WAS NOT (#479). FireSTARR names
 * its own outputs `sizes_<julian>_<YYYY-MM-DD>.csv` — a calendar date the engine
 * has ALREADY PAIRED with the Julian day its rasters are keyed to. There is no
 * time and no zone in the name, so there is nothing to misinterpret. The
 * weather.csv fallback was impossible for the opposite reason: its Date column
 * is a bare LOCAL timestamp, and the zone needed to read it lives in the very
 * config file whose absence is what triggers a fallback. At the moment it would
 * run, the information needed to use it correctly is by definition unavailable.
 *
 * MEASURED BEFORE BUILDING, on 194 real sizes files across four distinct years
 * (2021, 2023, 2024, 2025): the Julian in the name equals dayOfYear of the date
 * in the name in 194 of 194. So the pairing is the engine's own and is
 * consistent — and a file where the two DISAGREE is therefore anomalous, and is
 * rejected rather than guessed at.
 *
 * THE LIMIT, WHICH IS LOAD-BEARING. This recovers the DAY. It does not recover
 * the time of day, and it must never be made to look as though it did:
 *
 *   - the value is a calendar date STRING plus a `precision: 'day'` marker,
 *     never a `Date`. A Date is an instant, and the only instant available here
 *     is midnight — a NEW invented value, which is the whole defect #482 is
 *     about. It would be invisible once constructed.
 *   - it is enough for the YEAR (fuel vintage, #319) and to anchor Julian days.
 *   - it is NOT enough for the sub-day ignition fraction
 *     `arrivalTimeSymbolization` computes, and must not be handed to it.
 *
 * Shaped after `fuelVintageRecord.ts`: a labelled record carrying its own
 * provenance, so a derived value can never be mistaken for a recorded one.
 */

import { readdir } from 'fs/promises';

/** `sizes_<julian>_<YYYY-MM-DD>.csv` — the engine's own output naming. */
const SIZES_FILE = /^sizes_(\d+)_(\d{4})-(\d{2})-(\d{2})\.csv$/;

export interface DerivedModelDate {
  /**
   * The calendar date, `YYYY-MM-DD`. DAY PRECISION — there is deliberately no
   * time of day, because none was recorded.
   */
  date: string;
  /** The Julian day the engine paired with that date in the filename. */
  julianDay: number;
  /** Always 'day'. Present so a consumer must acknowledge the precision. */
  precision: 'day';
  /** The filename this came from, so a derived value stays traceable. */
  source: string;
}

/** Day of the year for a Y/M/D, leap years included. */
function dayOfYearFor(year: number, month: number, day: number): number {
  const jan1 = Date.UTC(year, 0, 1);
  return Math.floor((Date.UTC(year, month - 1, day) - jan1) / 86_400_000) + 1;
}

/**
 * Whether Y/M/D is a real calendar date.
 *
 * `Date.UTC` is lenient — it rolls 2023-02-29 forward to March 1 rather than
 * rejecting it. Round-tripping the components back out catches that, so a date
 * that was never written cannot be silently recovered as a neighbouring one.
 */
function isRealDate(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
  );
}

/**
 * The earliest day recorded by the engine's own sizes filenames, or undefined.
 *
 * Returns undefined — never a guess — when the directory is absent, holds no
 * sizes files, or holds only files whose Julian day and date disagree.
 */
export async function readDerivedModelDate(
  simDir: string,
): Promise<DerivedModelDate | undefined> {
  let names: string[];
  try {
    names = await readdir(simDir);
  } catch {
    // A missing or unreadable directory records nothing. Not an error here:
    // the caller is asking what was recorded, and the answer is nothing.
    return undefined;
  }

  let earliest: DerivedModelDate | undefined;

  for (const name of names) {
    const match = SIZES_FILE.exec(name);
    if (!match) {
      continue;
    }

    const julianDay = Number(match[1]);
    const year = Number(match[2]);
    const month = Number(match[3]);
    const day = Number(match[4]);

    if (!isRealDate(year, month, day)) {
      continue;
    }

    // The engine paired these two values. If they disagree the pairing is not
    // evidence of anything, so the file is skipped rather than trusted — 194 of
    // 194 real files agree, which is what makes a mismatch anomalous.
    if (dayOfYearFor(year, month, day) !== julianDay) {
      continue;
    }

    // Numeric comparison, deliberately: as strings '100' sorts before '99'.
    if (!earliest || julianDay < earliest.julianDay) {
      earliest = {
        date: `${match[2]}-${match[3]}-${match[4]}`,
        julianDay,
        precision: 'day',
        source: name,
      };
    }
  }

  return earliest;
}
