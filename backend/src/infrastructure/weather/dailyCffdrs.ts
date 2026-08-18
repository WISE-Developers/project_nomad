/**
 * Daily-only CFFDRS detection and starting-code recovery.
 *
 * Issue #351. Nomad supports two weather contracts and only two:
 *
 *   firestarr_csv — CFFDRS values on EVERY row, passed straight through
 *   raw_weather   — raw observations PLUS starting codes, Nomad calculates the rest
 *
 * A standard fire weather station writes hourly observations with the CFFDRS
 * indices recorded once per day, at noon LST. That file satisfies neither
 * contract: it enters as firestarr_csv, every non-noon row parses to NaN, and
 * the NaN reaches the FireSTARR command line and segfaults the engine.
 *
 * The user already has the starting codes — they are in the file. This module
 * finds them so they can be offered rather than guessed at or refused.
 *
 * Pure functions only. No HTTP, no filesystem, no engine.
 */

import { DateTime } from 'luxon';

/**
 * The minimal shape this module needs. Declared here rather than imported so
 * the detection logic does not depend on WeatherService's internals — any
 * record carrying a timestamp and three codes satisfies it structurally.
 */
export interface CffdrsRow {
  datetime: Date;
  ffmc: number;
  dmc: number;
  dc: number;
}

/** A daily reading recovered from the file, ready to be offered to the user. */
export interface StartingCodeCandidate {
  ffmc: number;
  dmc: number;
  dc: number;
  /** The instant the reading was taken. */
  observedAt: Date;
  /** Human-facing local label, e.g. "2026-08-03, 1300". */
  localLabel: string;
}

/**
 * Local hours that count as the daily CFFDRS reading.
 *
 * Daily codes are calculated at noon local standard time. Under daylight time
 * that lands on local hour 13, so both are accepted. Minutes are ignored
 * entirely — stations write at :00, :05, :06 or :10 depending on polling.
 */
const DAILY_READING_LOCAL_HOURS = [12, 13];

/** True when all three codes on a row are usable numbers. */
function hasCodes(row: CffdrsRow): boolean {
  return (
    Number.isFinite(row.ffmc) && Number.isFinite(row.dmc) && Number.isFinite(row.dc)
  );
}

/**
 * Detects the daily-only CFFDRS shape: some rows carry codes, others do not.
 *
 * Returns false when every row has codes (a conforming firestarr_csv) and false
 * when no row has codes (nothing to recover — a different failure).
 */
export function hasDailyOnlyCffdrs(rows: CffdrsRow[]): boolean {
  if (rows.length === 0) return false;

  const withCodes = rows.filter(hasCodes).length;

  // Both sides must be non-empty. All-codes is a conforming firestarr_csv;
  // no-codes is a different failure with nothing to recover.
  return withCodes > 0 && withCodes < rows.length;
}

/**
 * Finds the daily reading to offer as starting codes: the last row at a daily
 * local hour that falls STRICTLY BEFORE ignition.
 *
 * Strictly before matters. For an ignition at noon local, the same day's daily
 * row is typically an hour too late, and using it would be wrong for every
 * morning fire.
 *
 * Returns null when no such reading exists — the caller must not invent one.
 */
export function findStartingCodeCandidate(
  rows: CffdrsRow[],
  ignition: Date,
  timezone: string,
): StartingCodeCandidate | null {
  let best: CffdrsRow | null = null;

  for (const row of rows) {
    if (!hasCodes(row)) continue;
    if (row.datetime.getTime() >= ignition.getTime()) continue;

    const local = DateTime.fromJSDate(row.datetime, { zone: timezone });
    if (!DAILY_READING_LOCAL_HOURS.includes(local.hour)) continue;

    if (best === null || row.datetime.getTime() > best.datetime.getTime()) {
      best = row;
    }
  }

  if (best === null) return null;

  const local = DateTime.fromJSDate(best.datetime, { zone: timezone });

  return {
    ffmc: best.ffmc,
    dmc: best.dmc,
    dc: best.dc,
    observedAt: best.datetime,
    // Minutes are deliberately dropped — the reading names an hour, not an instant.
    localLabel: `${local.toFormat('yyyy-MM-dd, HH')}00`,
  };
}
