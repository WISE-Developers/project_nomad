/**
 * Hand an imported scenario to the engine the way creating a model does
 * (refs #294).
 *
 * The engine's public entry is initialize(model, options: ExecutionOptions),
 * and it derives the rest itself: lat/lon from the ignition centroid,
 * startDate/startTime from the timeRange, the perimeter from the ignition
 * type, the output offsets from the duration. So this module does NOT rebuild
 * FireSTARRParams — doing that would leave two sources of truth for one
 * mapping, and they would drift.
 *
 * The one thing that does not travel through ExecutionOptions on its own is
 * the .fgmj's own starting codes. buildParams reads them off the FIRST WEATHER
 * ROW (FireSTARREngine.ts:653-656) and passes them to FireSTARR as the
 * --ffmc/--dmc/--dc CLI flags. The .fgmj stream is five observation columns
 * with no fire-weather indices, so a naive conversion hands the engine
 * undefined and runs a different fire while looking entirely fine.
 *
 * Returns notices alongside the options. An import can be faithful in every
 * field and still describe a model that differs from what the file asked for;
 * a caller that cannot see those differences presents a wrong comparison as a
 * right one.
 */

import { TimeRange } from '../../domain/value-objects/TimeRange.js';
import type { ExecutionOptions } from '../interfaces/IFireModelingEngine.js';
import type { WeatherDataPoint } from '../interfaces/weather.js';
import type { ScenarioImportPlan } from './planFgmjImport.js';
import { toIgnitionGeometries } from './toIgnitionGeometry.js';

export interface ImportedExecution {
  readonly options: ExecutionOptions;
  /**
   * What this conversion did that the operator must be told about — distinct
   * from the plan's divergences, which describe the import itself.
   */
  readonly notices: string[];
}

/**
 * FireSTARR recomputes the daily fire weather from the noon records itself
 * (`if (12 == t.tm_hour)`, a literal in the engine — see
 * validateImportedWeather). The .fgmj records no per-hour indices, so there is
 * nothing truthful to put in these columns beyond the day-one codes that
 * become the CLI flags.
 *
 * Zero rather than the starting codes repeated: repeating them would assert a
 * flat drying trend across the whole run that the file never described.
 */
const NO_RECORDED_INDEX = 0;

export function toExecutionOptions(plan: ScenarioImportPlan): ImportedExecution {
  if (!plan.runnable) {
    throw new Error(
      `Scenario "${plan.scenarioName}" is not runnable as imported — ` +
        `blockers: ${plan.blockers.join(', ') || 'none recorded'}. ` +
        `${plan.blockerDetail.join(' ')} ` +
        'Clear the blockers before building an execution; filling in what is ' +
        'missing would produce a plausible wrong run.',
    );
  }

  if (plan.weather.length === 0) {
    throw new Error(
      `Scenario "${plan.scenarioName}" resolved no weather rows. FireSTARR ` +
        'cannot run without weather, and there is nothing here to substitute.',
    );
  }

  const geometries = toIgnitionGeometries(plan);
  if (geometries.length === 0) {
    throw new Error(
      `Scenario "${plan.scenarioName}" has no ignitions. FireSTARR needs ` +
        'somewhere to start the fire.',
    );
  }

  const notices: string[] = [];
  for (const g of geometries) {
    if (g.divergence) notices.push(g.divergence);
  }

  if (geometries.length > 1) {
    const shapes = geometries.map((g) => `${g.name} (${g.geometry.type})`).join(', ');
    throw new Error(
      `Scenario "${plan.scenarioName}" has ${geometries.length} ignitions — ${shapes}. ` +
        'Merging them is not implemented yet. Refusing rather than picking one.',
    );
  }

  const [ignition] = geometries;

  // Both carry an explicit offset, so neither is parsed against the server
  // zone — the #273/#402 class of bug.
  const start = new Date(plan.startTime); // new-date-allowed: ISO with explicit offset
  const end = new Date(plan.endTime); // new-date-allowed: ISO with explicit offset
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error(
      `Scenario "${plan.scenarioName}" has an unreadable window ` +
        `("${plan.startTime}" to "${plan.endTime}"). Refusing rather than ` +
        'substituting now.',
    );
  }

  const weatherData: WeatherDataPoint[] = plan.weather.map((row, i) => ({
    datetime: row.date,
    temperature: row.temp,
    humidity: row.rh,
    windSpeed: row.ws,
    windDirection: row.wd,
    precipitation: row.precip,
    // Day-one codes ride the first row, which is where the engine looks for
    // them. Every later row has no recorded index.
    ffmc: i === 0 ? plan.startingCodes.ffmc : NO_RECORDED_INDEX,
    dmc: i === 0 ? plan.startingCodes.dmc : NO_RECORDED_INDEX,
    dc: i === 0 ? plan.startingCodes.dc : NO_RECORDED_INDEX,
  }));

  if (plan.weather.length > 1) {
    notices.push(
      `The .fgmj recorded starting codes (FFMC ${plan.startingCodes.ffmc}, ` +
        `DMC ${plan.startingCodes.dmc}, DC ${plan.startingCodes.dc}) and hourly ` +
        'observations, but no hourly fire-weather indices. The starting codes are ' +
        'passed to FireSTARR, which rebuilds the daily fire weather from the noon ' +
        'records; the per-hour index columns are left at zero because the file ' +
        'never recorded them.',
    );
  }

  const options: ExecutionOptions = {
    ignitionGeometry: ignition.geometry,
    timeRange: new TimeRange(start, end),
    // The offset the file carried, e.g. "-06:00". Not a guessed IANA zone, and
    // not "UTC-6", which Luxon accepts and Intl rejects.
    timezone: plan.timezone,
    weatherData,
  };

  return { options, notices };
}
