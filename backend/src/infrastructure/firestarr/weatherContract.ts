/**
 * FireSTARR's weather input contract — issues #339, #340, #341.
 *
 * FireSTARR builds its daily fire weather from noon records only. From its own
 * source, quoted in #340:
 *
 *   if (12 == t.tm_hour) { auto& s_daily = wx_daily.at(cur); s_daily.emplace(day, ...); }
 *
 * A day with no hour-12 record therefore never gets a daily entry, and the
 * later lookup throws `FATAL: map::at` — about ten seconds in, with the reason
 * visible only in the container log (#339). Four of six runs on the CIFFC demo
 * died this way on 2026-08-19, every one with a first day that began after noon.
 *
 * Checking it here means the user is told what is wrong while they can still
 * fix it, instead of watching a job fail for reasons they cannot see.
 */

import { DateTime } from 'luxon';
import type { WeatherDataPoint } from '../../application/interfaces/weather.js';

export interface ContractResult {
  valid: boolean;
  /** Every problem found, phrased for the person who has to fix it. */
  issues: string[];
}

/** The hour FireSTARR records its daily values on. Not configurable — it is a literal in the engine. */
const NOON_HOUR = 12;

function local(instant: Date, timezone: string): DateTime {
  return DateTime.fromJSDate(instant, { zone: timezone });
}

/**
 * @param points   the weather series as it will be written to weather.csv
 * @param ignition the model start instant — timeRange.start
 * @param timezone the model's declared IANA zone, which weather.csv is written in
 * @param runEnd   timeRange.end. The contract applies to the SIMULATED WINDOW,
 *                 not to the whole file: weather files routinely carry trailing
 *                 hours past the end of the run, and a trailing stub day with no
 *                 noon record is harmless because the simulation never reaches
 *                 it. Requiring noon on those days rejected a known-good file
 *                 (SS005-23: 240 hourly rows ending in a single 06:00 row).
 *                 Omitted means "check every day", which only tests do.
 */
export function validateFireStarrContract(
  points: WeatherDataPoint[],
  ignition: Date,
  timezone: string,
  runEnd?: Date,
): ContractResult {
  const issues: string[] = [];

  if (points.length === 0) {
    return { valid: false, issues: ['The weather series is empty — there is nothing to model.'] };
  }

  // Group by local day, tracking which days carry an hour-12 record.
  const noonByDay = new Map<string, Date | null>();
  for (const point of points) {
    const zoned = local(point.datetime, timezone);
    const day = zoned.toFormat('yyyy-MM-dd');

    if (!noonByDay.has(day)) noonByDay.set(day, null);
    if (zoned.hour === NOON_HOUR && noonByDay.get(day) === null) {
      noonByDay.set(day, point.datetime);
    }
  }

  const daysWithoutNoon = [...noonByDay.entries()]
    .filter(([, noon]) => noon === null)
    .map(([day]) => day)
    // Days the run never reaches cannot break it. A leading partial day is NOT
    // excluded here — that side has production crashes behind it (#340).
    .filter((day) => {
      if (!runEnd) return true;
      const noonThatDay = DateTime.fromFormat(day, 'yyyy-MM-dd', { zone: timezone }).set({
        hour: NOON_HOUR,
      });
      return noonThatDay.toMillis() <= runEnd.getTime();
    })
    .sort();

  if (daysWithoutNoon.length > 0) {
    issues.push(
      `FireSTARR builds its daily fire weather from the noon (12:00) record of each day, ` +
        `and ${daysWithoutNoon.length === 1 ? 'this day has none' : 'these days have none'}: ` +
        `${daysWithoutNoon.join(', ')}. ` +
        `Weather that starts partway through a day is the usual cause — trim it to begin at ` +
        `or before noon, or start the model on the following day.`,
    );
  }

  // The ignition must sit at or after the first usable noon record, and within
  // the series. Before it, the codes for that day do not exist yet and whatever
  // starting codes were supplied are never applied to the fire.
  const firstNoon = [...noonByDay.entries()]
    .filter(([, noon]) => noon !== null)
    .map(([, noon]) => noon as Date)
    .sort((a, b) => a.getTime() - b.getTime())[0];

  const lastRecord = points
    .map((p) => p.datetime)
    .sort((a, b) => a.getTime() - b.getTime())
    .at(-1) as Date;

  if (firstNoon && ignition.getTime() < firstNoon.getTime()) {
    issues.push(
      `The ignition (${local(ignition, timezone).toFormat('yyyy-MM-dd HH:mm')}) is before the first ` +
        `noon record in the weather (${local(firstNoon, timezone).toFormat('yyyy-MM-dd HH:mm')}). ` +
        `FireSTARR has no fire weather for the hours before that, so the starting codes would ` +
        `never be applied. Set the ignition at or after ${local(firstNoon, timezone).toFormat('yyyy-MM-dd HH:mm')}.`,
    );
  }

  if (!firstNoon) {
    // No noon record anywhere, so there is no "first noon" to measure against.
    // An ignition before the series still needs reporting on its own terms.
    const firstRecord = points
      .map((p) => p.datetime)
      .sort((a, b) => a.getTime() - b.getTime())[0];

    if (ignition.getTime() < firstRecord.getTime()) {
      issues.push(
        `The ignition (${local(ignition, timezone).toFormat('yyyy-MM-dd HH:mm')}) is before the ` +
          `weather begins (${local(firstRecord, timezone).toFormat('yyyy-MM-dd HH:mm')}). ` +
          `FireSTARR has no conditions for the fire at all until then.`,
      );
    }
  }

  if (ignition.getTime() > lastRecord.getTime()) {
    issues.push(
      `The ignition (${local(ignition, timezone).toFormat('yyyy-MM-dd HH:mm')}) is after the weather ` +
        `ends (${local(lastRecord, timezone).toFormat('yyyy-MM-dd HH:mm')}). Provide weather that ` +
        `covers the ignition, or move the ignition into the period the weather covers.`,
    );
  }

  return { valid: issues.length === 0, issues };
}
