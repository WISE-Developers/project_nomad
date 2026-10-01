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
 * Weather goes through the CONFIG branch, not pre-resolved rows. buildParams
 * accepts either: `weatherData` is taken verbatim, while `weatherConfig` is
 * resolved through WeatherService, which steps the .fgmj's starting codes
 * forward with the real `cffdrs` library.
 *
 * That distinction is not cosmetic. The .fgmj records observations and
 * STARTING codes only, never hourly indices — so the weatherData branch would
 * force this module to invent the FFMC/DMC/DC columns, and **a zero in a
 * CFFDRS column tells FireSTARR not to burn that hour**. Zero-filling them
 * produced a fire that ignited and never spread across a full 72-hour run.
 * The config branch invents nothing and reuses science already implemented and
 * tested in WeatherService.
 *
 * Returns notices alongside the options. An import can be faithful in every
 * field and still describe a model that differs from what the file asked for;
 * a caller that cannot see those differences presents a wrong comparison as a
 * right one.
 */

import { TimeRange } from '../../domain/value-objects/TimeRange.js';
import type { ExecutionOptions } from '../interfaces/IFireModelingEngine.js';
import type { ScenarioImportPlan } from './planFgmjImport.js';
import { toIgnitionGeometries } from './toIgnitionGeometry.js';
import { toWeatherConfig } from './toWeatherConfig.js';
import { mergeIgnitions } from './mergeIgnitions.js';

export interface ImportedExecution {
  readonly options: ExecutionOptions;
  /**
   * What this conversion did that the operator must be told about — distinct
   * from the plan's divergences, which describe the import itself.
   */
  readonly notices: string[];
}

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

  // More than one ignition merges into a single MultiPolygon rather than
  // being refused or picked from arbitrarily — see mergeIgnitions for the
  // point-to-circle conversion and the LINE refusal it still applies.
  const ignitionGeometry =
    geometries.length > 1
      ? (() => {
          const merged = mergeIgnitions(geometries);
          notices.push(...merged.notices);
          return merged.geometry;
        })()
      : geometries[0].geometry;

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

  const options: ExecutionOptions = {
    ignitionGeometry,
    timeRange: new TimeRange(start, end),
    // The offset the file carried, e.g. "-06:00". Not a guessed IANA zone, and
    // not "UTC-6", which Luxon accepts and Intl rejects.
    timezone: plan.timezone,
    // The config branch, so WeatherService steps the starting codes forward
    // with cffdrs. Never pre-resolved rows: that would mean writing index
    // columns the file never recorded, and a zero there is an instruction not
    // to burn.
    weatherConfig: toWeatherConfig(plan),
  };

  return { options, notices };
}
