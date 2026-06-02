/**
 * Strict ISO-8601 date parsing.
 *
 * Centralizes the `string → Date` conversion the codebase used to spread
 * across `new Date(stringArg)` calls. Bare timestamps (no offset) are
 * rejected here — callers that know the zone must use a TZ-aware parser
 * (Luxon `fromSQL` / `fromFormat` with explicit `zone`).
 *
 * Refs #273 (TZ double-adjust hardening).
 */

import { DateTime } from 'luxon';

/**
 * Parses an ISO-8601 string into a JS Date. Throws if the string is empty,
 * missing an offset (`Z` or `±HH:MM`), or otherwise invalid.
 *
 * @param raw    The candidate ISO string.
 * @param context Human-readable label of where this value came from
 *                (used in the error message to make failures debuggable).
 */
export function parseIsoToDate(raw: string, context: string): Date {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error(`parseIsoToDate(${context}): expected non-empty ISO string, got ${raw === '' ? 'empty string' : typeof raw}`);
  }
  const dt = DateTime.fromISO(raw, { setZone: true });
  if (!dt.isValid) {
    throw new Error(
      `parseIsoToDate(${context}): invalid ISO-8601 string "${raw}": ${dt.invalidReason ?? 'unknown'}`,
    );
  }
  // Bare timestamps (no offset, no zone) are ambiguous. Reject.
  if (dt.offset === 0 && !/Z|[+-]\d{2}:?\d{2}$/.test(raw)) {
    throw new Error(
      `parseIsoToDate(${context}): bare timestamp "${raw}" has no UTC offset; use a TZ-aware parser instead`,
    );
  }
  return dt.toJSDate();
}

/**
 * Parses a timestamp coming out of the database. Tolerates both formats we
 * actually store: ISO-8601 with offset (written by app code via `.toISOString()`)
 * and bare SQL timestamps (written by SQLite's `CURRENT_TIMESTAMP` / Knex's
 * `knex.fn.now()`, which are always in UTC). Throws on anything else.
 */
export function parseDbTimestamp(raw: string, context: string): Date {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error(`parseDbTimestamp(${context}): expected non-empty string, got ${raw === '' ? 'empty string' : typeof raw}`);
  }
  // Prefer ISO if the string carries an offset; otherwise assume UTC (SQLite default).
  const isoTry = DateTime.fromISO(raw, { setZone: true });
  if (isoTry.isValid && /Z|[+-]\d{2}:?\d{2}$/.test(raw)) {
    return isoTry.toJSDate();
  }
  const sqlTry = DateTime.fromSQL(raw, { zone: 'utc' });
  if (sqlTry.isValid) return sqlTry.toJSDate();
  // Fall back to ISO interpreted as UTC for cases like "2026-01-01T12:00:00" (no offset).
  if (isoTry.isValid) {
    return DateTime.fromISO(raw, { zone: 'utc' }).toJSDate();
  }
  throw new Error(
    `parseDbTimestamp(${context}): unparseable timestamp "${raw}"`,
  );
}
