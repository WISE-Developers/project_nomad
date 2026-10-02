/**
 * Decide what to do with a polygon weather patch (refs #294).
 *
 * A patch bounded by a polygon changes conditions over part of the map. A
 * FireSTARR weather stream is ONE series for the whole run, so there is
 * nowhere to put a spatially-limited change. This importer cannot make it do
 * what it cannot do.
 *
 * So the operator gets the best available choice — apply it to the whole run,
 * or ignore it — and NEITHER reproduces the original. Applying globally also
 * changes weather outside the polygon; ignoring drops a modification the author
 * deliberately made.
 *
 * Whichever is chosen is recorded as a divergence. #294 exists so old incidents
 * can be re-run and COMPARED, and a difference that vanished once its blocker
 * cleared would quietly undermine the comparison the import was for.
 */

import { applyWeatherPatch } from './applyWeatherPatch.js';
import {
  asObservations,
  asPatchable,
  type ScenarioImportPlan,
} from './planFgmjImport.js';

/** What the operator chose for a polygon patch. */
export type PolygonPatchChoice = 'global' | 'ignore';

const CHOICES: PolygonPatchChoice[] = ['global', 'ignore'];

/**
 * Apply the operator's decisions.
 *
 * Patches with no decision are left alone and keep the blocker — an undecided
 * patch must not default to either choice, because both change the result.
 */
export function resolvePolygonPatches(
  plan: ScenarioImportPlan,
  decisions: Record<string, PolygonPatchChoice>,
): ScenarioImportPlan {
  for (const [name, choice] of Object.entries(decisions)) {
    if (!plan.polygonPatches.includes(name)) {
      throw new Error(
        `Scenario "${plan.scenarioName}" has no polygon weather patch named "${name}". ` +
          `It has: ${plan.polygonPatches.join(', ') || '(none)'}.`,
      );
    }
    if (!CHOICES.includes(choice)) {
      throw new Error(
        `Unknown choice "${choice}" for polygon patch "${name}". ` +
          `Expected one of: ${CHOICES.join(', ')}.`,
      );
    }
  }

  const warnings = [...plan.warnings];
  const divergences = [...plan.divergences];
  const appliedPatches = [...plan.appliedPatches];
  const undecided: string[] = [];
  const remainingFilters: typeof plan.polygonPatchFilters = [];
  let weather = plan.weather;

  for (const patch of plan.polygonPatchFilters) {
    const choice = decisions[patch.name];

    if (choice === undefined) {
      undecided.push(patch.name);
      remainingFilters.push(patch);
      continue;
    }

    if (choice === 'ignore') {
      divergences.push(
        `Polygon weather patch "${patch.name}" was NOT applied, by choice. The original ` +
          'run modified weather inside that polygon; this import does not.',
      );
      continue;
    }

    const result = applyWeatherPatch(asPatchable(weather), patch);
    weather = asObservations(result.rows);
    warnings.push(...result.warnings);
    appliedPatches.push(patch.name);
    divergences.push(
      `Polygon weather patch "${patch.name}" was applied to the WHOLE run, by choice. ` +
        'The original bounded it to a polygon; a weather stream cannot be limited ' +
        'spatially, so conditions outside that polygon are modified here too.',
    );
  }

  // blockers and blockerDetail are pushed in lockstep, one detail per blocker,
  // so the same index addresses both.
  const index = plan.blockers.indexOf('polygonWeatherPatch');
  const stillBlocked = undecided.length > 0;
  const blockers =
    stillBlocked || index === -1 ? plan.blockers : plan.blockers.filter((_, i) => i !== index);
  const blockerDetail =
    stillBlocked || index === -1
      ? plan.blockerDetail
      : plan.blockerDetail.filter((_, i) => i !== index);

  return {
    ...plan,
    weather,
    appliedPatches,
    polygonPatches: undecided,
    polygonPatchFilters: remainingFilters,
    warnings,
    divergences,
    blockers,
    blockerDetail,
    runnable: blockers.length === 0,
  };
}
