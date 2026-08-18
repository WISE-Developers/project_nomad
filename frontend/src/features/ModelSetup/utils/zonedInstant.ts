/**
 * Zone-aware instant construction — issue #355.
 *
 * The wizard collects a date, a time, and an IANA timezone. Combining them with
 * `new Date("YYYY-MM-DDTHH:mm")` reads the string in the BROWSER's zone, so the
 * timezone the user explicitly chose is ignored and the same inputs produce
 * different instants depending on where the operator happens to be sitting.
 *
 * There is no date library in this package and we are not adding one for this.
 * Intl carries the whole timezone database, and dateHelpers.ts already leans on
 * it, so the offset is looked up rather than assumed — which also means DST and
 * half-hour zones fall out correctly instead of needing special cases.
 */

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * How far the given zone sits from UTC at a particular instant, in ms.
 *
 * Works by asking Intl what wall-clock time the zone shows at that instant,
 * then reading that wall clock back as if it were UTC. The difference is the
 * offset. hourCycle h23 keeps midnight as 00 rather than 24.
 */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts: Record<string, number> = {};
  for (const { type, value } of formatter.formatToParts(new Date(instant))) {
    if (type !== 'literal') parts[type] = Number(value);
  }

  const wallClockAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return wallClockAsUtc - instant;
}

/** Rejects an unknown zone rather than letting Intl fall back to the browser's. */
function assertZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
  } catch {
    throw new Error(`Unknown timezone: ${timeZone}`);
  }
}

/**
 * @param date     YYYY-MM-DD
 * @param time     HH:mm or HH:mm:ss. Empty means midnight local.
 * @param timeZone IANA identifier — the model's zone, never the browser's.
 */
export function resolveZonedInstant(date: string, time: string, timeZone: string): Date {
  assertZone(timeZone);

  const dateMatch = DATE_PATTERN.exec(date);
  if (!dateMatch) {
    throw new Error(`Invalid date "${date}" — expected YYYY-MM-DD`);
  }

  const normalisedTime = time.trim() === '' ? '00:00' : time.trim();
  const timeMatch = TIME_PATTERN.exec(normalisedTime);
  if (!timeMatch) {
    throw new Error(`Invalid time "${time}" — expected HH:mm`);
  }

  const [, year, month, day] = dateMatch.map(Number);
  const [, hour, minute, second] = timeMatch.map((v) => Number(v ?? 0));

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`Invalid date "${date}"`);
  }
  if (hour > 23 || minute > 59 || (second || 0) > 59) {
    throw new Error(`Invalid time "${time}"`);
  }

  // Read the wall clock as if it were UTC, then walk back by the zone's offset.
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, second || 0);

  // Two passes. The first offset is looked up at the wrong instant by exactly
  // the offset itself; re-reading at the corrected instant settles it, which is
  // what makes DST changeover days land correctly.
  let instant = wallClockAsUtc - zoneOffsetMs(wallClockAsUtc, timeZone);
  instant = wallClockAsUtc - zoneOffsetMs(instant, timeZone);

  return new Date(instant);
}
