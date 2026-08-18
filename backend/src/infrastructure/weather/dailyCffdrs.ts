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
export function hasDailyOnlyCffdrs(_rows: CffdrsRow[]): boolean {
  throw new Error('not implemented');
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
  _rows: CffdrsRow[],
  _ignition: Date,
  _timezone: string,
): StartingCodeCandidate | null {
  throw new Error('not implemented');
}

// Referenced by the implementation; declared above to keep the contract visible.
void DAILY_READING_LOCAL_HOURS;
void hasCodes;
void DateTime;
