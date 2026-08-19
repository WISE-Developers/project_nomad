/**
 * Local calendar helpers for daily fire weather codes — issue #352.
 *
 * DMC and DC are DAILY codes, defined by CFFDRS against noon LST conditions.
 * Two things follow, and the previous implementation got both wrong:
 *
 *   1. They roll over on the LOCAL day boundary, not the UTC one. In Edmonton
 *      UTC midnight falls at 18:00 the previous local day, so a single local
 *      day was being split in two and updated twice.
 *   2. They are driven by the observation nearest local NOON, not by whichever
 *      row happens to come first in the day.
 *
 * The timezone contract (#354) makes this well defined: the CSV Date column is
 * local time in the model's declared zone.
 */

import { DateTime } from 'luxon';

/** Calendar day in the given zone, as YYYY-MM-DD. */
export function localDayKey(instant: Date, timezone: string): string {
  return DateTime.fromJSDate(instant, { zone: timezone }).toFormat('yyyy-MM-dd');
}

/** Calendar month in the given zone, 1-based, for the CFFDRS day-length term. */
export function localMonth(instant: Date, timezone: string): number {
  return DateTime.fromJSDate(instant, { zone: timezone }).month;
}

/** Noon, in hours, as CFFDRS defines the daily observation. */
const NOON_HOUR = 12;

/**
 * For each local day, the index of the observation that should drive that day's
 * DMC and DC — the one nearest local noon.
 *
 * Stations poll at :00, :05, :06 or :10, and files often start mid-morning, so
 * an exact noon row cannot be assumed. Nearest-to-noon is always defined and
 * degrades gracefully. Ties go to the earlier observation, which keeps the
 * result deterministic.
 */
export function pickDailyDriverIndices(
  instants: Date[],
  timezone: string,
): Map<string, number> {
  const drivers = new Map<string, number>();
  const distances = new Map<string, number>();

  instants.forEach((instant, index) => {
    const day = localDayKey(instant, timezone);
    const local = DateTime.fromJSDate(instant, { zone: timezone });
    const distance = Math.abs(local.hour + local.minute / 60 - NOON_HOUR);

    const best = distances.get(day);
    if (best === undefined || distance < best) {
      distances.set(day, distance);
      drivers.set(day, index);
    }
  });

  return drivers;
}
