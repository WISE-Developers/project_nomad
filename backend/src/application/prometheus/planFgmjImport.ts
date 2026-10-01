/**
 * Plan what a Prometheus/WISE .fgmj would import (refs #294).
 *
 * Composes the pieces — parse, resolve, weather, patches, ignitions — into one
 * answer per scenario, since one scenario becomes one model.
 *
 * It produces a PLAN rather than a FireSTARR model on purpose. FireSTARRParams
 * requires latitude and longitude in WGS84, and every sample .fgmj carries
 * projected metres whose CRS the file does not record. Until the operator
 * supplies one there is no lat/lon to give, and inventing it would place the
 * fire hundreds of kilometres from where it belongs.
 *
 * So a plan states its blockers. An operator pointing Nomad at a directory of
 * old job files learns what each needs before anything runs — more useful than
 * a half-built model, and far better than a plausible wrong one.
 */

import { loadFgmjProject } from './loadFgmjProject.js';
import { resolveScenarios } from './resolveScenarios.js';
import { extractWeatherStream, type WeatherObservation, type StartingCodes } from './extractWeatherStream.js';
import { applyWeatherPatch } from './applyWeatherPatch.js';
import { extractIgnitions, type ExtractedIgnition } from './extractIgnitions.js';
import type { ResolvedFilter } from './resolveScenarios.js';
import { validateImportedWeather } from './validateImportedWeather.js';
import type { WeatherHourlyData } from '../../infrastructure/firestarr/types.js';

/** Why a scenario cannot be run as imported. */
export type ImportBlocker = 'crs' | 'polygonWeatherPatch' | 'weatherContract';

export interface ScenarioImportPlan {
  scenarioName: string;
  /** ISO 8601 with the offset the file carried. */
  startTime: string;
  endTime: string;
  durationHours: number;

  ignitions: ExtractedIgnition[];
  /** The scenario's own stream, with the scenario's own patches applied. */
  weather: WeatherObservation[];
  startingCodes: StartingCodes;
  /** Names of the patches actually applied, in order. */
  appliedPatches: string[];
  /** Fuel patches the file asked for and this importer did not apply. */
  skippedFuelPatches: string[];
  /** Weather patches bounded by a polygon, awaiting an operator decision. */
  polygonPatches: string[];
  /**
   * The same patches as objects, so a decision can actually apply one. Carried
   * rather than re-resolved: the decision step should act on exactly the patch
   * the operator was shown, not on a second reading of the file.
   */
  polygonPatchFilters: ResolvedFilter[];

  /**
   * Set only once the coordinates are known to be lat/lon. Never derived from a
   * guessed CRS.
   */
  latitude?: number;
  longitude?: number;

  blockers: ImportBlocker[];
  /** The same blockers in words an operator can act on. */
  blockerDetail: string[];
  /** Notices that do not block — clamped humidity, and such. */
  warnings: string[];
  /**
   * Ways the imported model DIFFERS from the run the .fgmj described.
   *
   * #294 exists so old incidents can be re-run and compared, so a divergence
   * that disappears once its blocker clears would undermine the comparison the
   * import was for. These travel with the plan instead.
   */
  divergences: string[];
  runnable: boolean;
}

/**
 * applyWeatherPatch works on FireSTARR rows; observations are the same five
 * columns without the fire-weather indices, which patches never touch. This
 * keeps the patch code working on one row type rather than two.
 */
export function asPatchable(rows: WeatherObservation[]): WeatherHourlyData[] {
  return rows as unknown as WeatherHourlyData[];
}

export function asObservations(rows: WeatherHourlyData[]): WeatherObservation[] {
  return rows as unknown as WeatherObservation[];
}

export function planFgmjImport(filePath: string): ScenarioImportPlan[] {
  const project = loadFgmjProject(filePath);

  return resolveScenarios(project).map((scenario) => {
    const { rows, startingCodes } = extractWeatherStream(scenario);
    const ignitions = extractIgnitions(scenario);

    // Only the filters this scenario names, in the order it names them. The
    // file may declare others; applying those would be wrong.
    const warnings: string[] = [];
    const divergences: string[] = [];
    const appliedPatches: string[] = [];
    const skippedFuelPatches: string[] = [];
    const polygonPatches: string[] = [];
    const polygonPatchFilters: ResolvedFilter[] = [];
    let weather = rows;

    for (const patch of scenario.weatherFilters) {
      // Fuels come from Nomad, as for any other run. Notify and skip.
      if (patch.kind === 'fuel') {
        skippedFuelPatches.push(patch.name);
        divergences.push(
          `Fuel patch "${patch.name}" was NOT applied — fuels come from Nomad, and ` +
            'there is no way to apply a fuel patch to a Nomad run. The imported model ' +
            'uses Nomad\u2019s fuel grid where the original used the author\u2019s patch.',
        );
        warnings.push(
          `Scenario "${scenario.name}" uses fuel patch "${patch.name}", which was NOT ` +
            'applied. Fuels come from Nomad, so the imported run will use Nomad’s ' +
            'fuel grid rather than the patch the original author applied.',
        );
        continue;
      }

      // A weather patch bounded by a polygon affects part of the landscape, and
      // the stream is a single series for the whole run — there is nowhere to
      // put a spatially-limited change. Policy is to offer the operator global
      // or ignore, so this records the decision rather than silently choosing.
      if (!patch.landscape) {
        polygonPatches.push(patch.name);
        polygonPatchFilters.push(patch);
        continue;
      }

      const result = applyWeatherPatch(asPatchable(weather), patch);
      weather = asObservations(result.rows);
      warnings.push(...result.warnings);
      appliedPatches.push(patch.name);
    }

    const projected = ignitions.some((ignition) => ignition.requiresCrs);
    const blockers: ImportBlocker[] = [];
    const blockerDetail: string[] = [];

    if (polygonPatches.length > 0) {
      blockers.push('polygonWeatherPatch');
      blockerDetail.push(
        `Scenario "${scenario.name}" uses weather patch(es) bounded by a polygon rather ` +
          `than the whole landscape: ${polygonPatches.join(', ')}. A weather stream is one ` +
          'series for the entire run, so a patch covering part of the map cannot be ' +
          'applied as written. Choose whether to apply each as a global patch or to ' +
          'ignore it; neither can be chosen here.',
      );
    }

    if (projected) {
      blockers.push('crs');
      blockerDetail.push(
        `Scenario "${scenario.name}" has ignition coordinates in projected units, and ` +
          'the .fgmj does not record which coordinate reference system they use — it ' +
          'names a projection that lived beside the original fuel grid. Supply the CRS ' +
          '(an EPSG or ESRI code) before running; it cannot be inferred from the file.',
      );
    }

    // Lat/lon is offered only when the file already carried it. A projected
    // scenario gets nothing here rather than a converted guess.
    const latLonPoint =
      !projected && ignitions[0]?.latLonPoints?.[0] ? ignitions[0].latLonPoints[0] : undefined;

    const plan: ScenarioImportPlan = {
      scenarioName: scenario.name,
      startTime: scenario.startTime,
      endTime: scenario.endTime,
      durationHours: scenario.durationHours,
      ignitions,
      weather,
      startingCodes,
      appliedPatches,
      skippedFuelPatches,
      polygonPatches,
      polygonPatchFilters,
      ...(latLonPoint ? { latitude: latLonPoint.lat, longitude: latLonPoint.lon } : {}),
      blockers,
      blockerDetail,
      warnings,
      divergences,
      runnable: blockers.length === 0,
    };

    // FireSTARR reads its daily weather from noon rows only, and a missing one
    // kills the run ten seconds in with the reason buried in a container log.
    // Checked against the assembled plan, because patches and decisions can
    // change the stream before it is written.
    const contractIssues = validateImportedWeather(plan);
    if (contractIssues.length > 0) {
      plan.blockers = [...plan.blockers, 'weatherContract'];
      plan.blockerDetail = [
        ...plan.blockerDetail,
        `Scenario "${scenario.name}" produces weather FireSTARR cannot read: ` +
          `${contractIssues.join(' ')}`,
      ];
      plan.runnable = false;
    }

    return plan;
  });
}
