/**
 * Strict ISO-8601 date parsing (domain).
 *
 * The pure `string → Date` conversion used by domain value objects such as
 * {@link TimeRange}. Lives in the domain layer so domain code does not depend
 * outward on the shared/ utility ring (Dependency Inversion). Bare timestamps
 * (no offset) are rejected — callers that know the zone must use a TZ-aware
 * parser. Refs #273 (TZ double-adjust hardening).
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
