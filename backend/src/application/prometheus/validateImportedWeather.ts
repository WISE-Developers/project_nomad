/**
 * Check imported weather against FireSTARR's input contract (refs #294).
 *
 * FireSTARR builds its daily fire weather from NOON records only — `if (12 ==
 * t.tm_hour)`, a literal in the engine rather than a setting. A day inside the
 * simulated window with no hour-12 row never gets a daily entry, and the later
 * lookup dies with `FATAL: map::at` about ten seconds in, with the reason
 * visible only in the container log. Four of six runs on the CIFFC demo died
 * that way (#339, #340, #341).
 *
 * An imported .fgmj can produce exactly such a stream: its weather begins
 * wherever the original author's did and the window opens wherever they put the
 * ignition. Checking here means the operator hears about it while they can
 * still act, instead of watching a job fail for reasons they cannot see.
 *
 * The contract logic itself is NOT reimplemented. validateFireStarrContract
 * already encodes the subtleties — notably that trailing days past the end of
 * the run are harmless, a rule learned by rejecting a known-good file.
 */

import {
  validateFireStarrContract,
  type TimestampedWeatherRow,
} from '../../infrastructure/firestarr/weatherContract.js';
import type { ScenarioImportPlan } from './planFgmjImport.js';
import { timezoneOf } from './importTimezone.js';

/**
 * @returns every problem found, phrased for the person who has to fix it.
 *          Empty means the stream satisfies the contract.
 */
export function validateImportedWeather(plan: ScenarioImportPlan): string[] {
  // One spelling for both libraries: Luxon accepts 'UTC-6' but Intl does not,
  // and these offsets reach both. See importTimezone.
  const zone = plan.timezone || timezoneOf(plan.startTime);

  // Only the timestamps matter here. Nothing is invented to fill the
  // fire-weather codes the observations do not yet carry.
  const points: TimestampedWeatherRow[] = plan.weather.map((row) => ({
    datetime: row.date,
  }));

  // Both carry an explicit offset, so neither is parsed against the server zone.
  const ignition = new Date(plan.startTime); // new-date-allowed: ISO with explicit offset
  const runEnd = new Date(plan.endTime); // new-date-allowed: ISO with explicit offset

  return validateFireStarrContract(points, ignition, zone, runEnd).issues;
}
