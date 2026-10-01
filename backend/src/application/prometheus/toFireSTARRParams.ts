/**
 * Turn an import plan into a runnable FireSTARRParams (refs #294).
 *
 * Everything upstream of this produced a PLAN — geometry, weather, blockers —
 * and never a model. #294 exists so an old incident can be re-run and
 * compared, and a plan that cannot become a model does not do that. This is
 * the step that closes it.
 *
 * It returns the params together with NOTICES rather than the params alone.
 * The import can be faithful in every field and still describe a model that
 * differs from what the .fgmj asked for, and a caller that cannot see those
 * differences will present a wrong comparison as a right one. Making the
 * notices part of the return type means a caller has to look at them.
 *
 * Divergences stay on the plan. Those describe how the IMPORT differs from the
 * original run; notices here describe choices this ASSEMBLY made.
 */

import { SpatialGeometry } from '../../domain/entities/index.js';
import { formatLocalTime } from '../../infrastructure/firestarr/timezoneUtils.js';
import type { FireSTARRParams } from '../../infrastructure/firestarr/types.js';
import type { ScenarioImportPlan } from './planFgmjImport.js';
import { asPatchable } from './planFgmjImport.js';
import { toIgnitionGeometries } from './toIgnitionGeometry.js';

export interface FireSTARRAssembly {
  readonly params: FireSTARRParams;
  /**
   * Choices this assembly made that the operator must be told about — not the
   * plan's divergences, which describe the import itself.
   */
  readonly notices: string[];
}

const HOURS_PER_DAY = 24;

/**
 * One output per day of the window, which is what the engine does for a
 * wizard-built run (FireSTARREngine.calculateOutputOffsets). Partial days
 * round up: a 36-hour scenario asked for a second day and should report it.
 */
function outputOffsetsFor(durationHours: number): number[] {
  const days = Math.ceil(durationHours / HOURS_PER_DAY);
  if (days <= 0) {
    throw new Error(
      `Scenario duration is ${durationHours} hours, which is not a window that can ` +
        'be run. Refusing rather than running a zero-length simulation.',
    );
  }
  return Array.from({ length: days }, (_, i) => i + 1);
}

export function toFireSTARRParams(plan: ScenarioImportPlan): FireSTARRAssembly {
  if (!plan.runnable) {
    throw new Error(
      `Scenario "${plan.scenarioName}" is not runnable as imported — ` +
        `blockers: ${plan.blockers.join(', ') || 'none recorded'}. ` +
        `${plan.blockerDetail.join(' ')} ` +
        'Clear the blockers before assembling a model; filling in what is missing ' +
        'would produce a plausible wrong run.',
    );
  }

  // Set only once the coordinates are known to be lat/lon, never from a guessed
  // CRS — so an absent value here means the plan lied about being runnable.
  if (plan.latitude === undefined || plan.longitude === undefined) {
    throw new Error(
      `Scenario "${plan.scenarioName}" reports runnable but carries no lat/lon. ` +
        'That is a contradiction in the plan, not something to fill in.',
    );
  }

  const geometries = toIgnitionGeometries(plan);
  if (geometries.length === 0) {
    throw new Error(
      `Scenario "${plan.scenarioName}" has no ignitions. FireSTARR needs somewhere ` +
        'to start the fire.',
    );
  }

  const notices: string[] = [];
  for (const g of geometries) {
    if (g.divergence) notices.push(g.divergence);
  }

  if (geometries.length > 1) {
    // Deliberately unimplemented rather than defaulted. FireSTARRParams holds
    // ONE ignitionGeometry and GeometryType is Point | LineString | Polygon
    // with no multipart member, so there is no single geometry that can hold
    // these. Appending a second polygon as another ring would make it a HOLE
    // in the first and silently stop that fire burning; a hull or union would
    // burn ground that was never ignited.
    const shapes = geometries.map((g) => `${g.name} (${g.geometry.type})`).join(', ');
    throw new Error(
      `Scenario "${plan.scenarioName}" has ${geometries.length} ignitions — ${shapes}. ` +
        'Merging them needs a multipart geometry, which SpatialGeometry cannot yet ' +
        'express. Refusing rather than picking one or folding them together wrongly.',
    );
  }

  const [ignition] = geometries;

  // The instant, not a wall-clock string. The engine derives the local date
  // itself via formatLocalDate(startDate, timezone); handing it a date built
  // from UTC parts would roll the date for any evening start west of UTC.
  const startDate = new Date(plan.startTime);
  if (Number.isNaN(startDate.getTime())) {
    throw new Error(
      `Scenario "${plan.scenarioName}" has an unreadable start time ` +
        `"${plan.startTime}". Refusing rather than substituting now.`,
    );
  }

  const params: FireSTARRParams = {
    latitude: plan.latitude,
    longitude: plan.longitude,
    startDate,
    // Same helper the engine uses for a wizard run, so an imported run and a
    // hand-built one agree on what the wall-clock time means.
    startTime: formatLocalTime(startDate, plan.timezone),
    timezone: plan.timezone,
    weatherData: asPatchable(plan.weather),
    previousFFMC: plan.startingCodes.ffmc,
    previousDMC: plan.startingCodes.dmc,
    previousDC: plan.startingCodes.dc,
    previousPrecip: plan.startingCodes.precipitation,
    ignitionGeometry: ignition.geometry as SpatialGeometry,
    outputDateOffsets: outputOffsetsFor(plan.durationHours),
  };

  return { params, notices };
}
