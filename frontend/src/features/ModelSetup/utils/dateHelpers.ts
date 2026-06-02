/**
 * Local-calendar date helpers for the ModelSetup wizard.
 *
 * The wizard's default start-date options ("today", "yesterday", "fire-season")
 * must reflect the user's LOCAL calendar day. Using `Date.toISOString()` for
 * defaults breaks for users west of UTC (the early-evening reading is already
 * the next UTC day). Helpers accept an optional IANA timezone so callers can
 * pin behavior; default is the browser's resolved zone.
 *
 * Refs #273 (TZ double-adjust root cause).
 */

const FIRE_SEASON_START_MONTH = 4; // April (1-indexed for output)
const FIRE_SEASON_START_DAY = 1;

function resolveTimeZone(timeZone: string | undefined): string {
  return timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Formats a Date as YYYY-MM-DD in the given IANA timezone.
 * `en-CA` locale yields ISO-like YYYY-MM-DD ordering.
 */
function formatYMD(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Returns today's date as YYYY-MM-DD in the caller's local timezone.
 *
 * @param timeZone IANA zone (e.g. "America/Vancouver"). Defaults to browser zone.
 */
export function getTodayDate(timeZone?: string): string {
  return formatYMD(new Date(), resolveTimeZone(timeZone));
}

/**
 * Returns yesterday's date as YYYY-MM-DD in the caller's local timezone.
 *
 * Decrements the calendar day on the local-zone date; handles month/year rollover.
 */
export function getYesterdayDate(timeZone?: string): string {
  const tz = resolveTimeZone(timeZone);
  const [y, m, d] = getTodayDate(tz).split('-').map(Number);
  // YYYY-MM-DD strings are timezone-agnostic; decrement via UTC math.
  const yesterday = new Date(Date.UTC(y, m - 1, d - 1));
  const yy = yesterday.getUTCFullYear();
  const mm = String(yesterday.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(yesterday.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Returns the start of fire season (April 1) for the current local year.
 */
export function getFireSeasonStartDate(timeZone?: string): string {
  const tz = resolveTimeZone(timeZone);
  const year = getTodayDate(tz).slice(0, 4);
  const month = String(FIRE_SEASON_START_MONTH).padStart(2, '0');
  const day = String(FIRE_SEASON_START_DAY).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
