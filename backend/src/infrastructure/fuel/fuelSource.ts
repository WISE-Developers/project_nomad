/**
 * Which fuel source a run uses, and how that choice is recorded. #282 task 6,
 * condition 5.
 *
 * WIRED by #282, and this module is the one where that mattered most.
 * `infrastructure/firestarr/fuelGridForRun.ts` calls `resolveFuelSource` once per run,
 * so the two rules below now RUN rather than describe intent, and rule 2's throw is
 * reachable. v0.55.0's upgrading.md briefly documented this key as operator-facing,
 * including the promise that misconfiguring it fails rather than falling back; that was
 * corrected before release precisely because the promise had no mechanism behind it.
 * The mechanism exists now, so the key is documented for operators again.
 *
 * THE DEFAULT DID NOT CHANGE WHEN IT WAS WIRED. Unset still means `local`, because the
 * WCS source ships opt-in and non-default (Franco, 2026-11-18: "no its optional, and not
 * a default at this time" — "at this time" being a not-yet rather than a never).
 *
 * TWO RULES, AND THEY ARE THE WHOLE MODULE.
 *
 * 1. An installation that has local fuel tiles keeps working with no
 *    configuration at all. Every deployment in the field today sets none of
 *    these variables, so an unset environment MUST mean `local`.
 *
 * 2. Asking for the WCS and being misconfigured FAILS. There is deliberately no
 *    fallback between fuel sources, in either direction. A fallback would run a
 *    fire model on a grid nobody chose while the operator believed otherwise,
 *    and nothing in the output would say which one it was. A silent default is a
 *    lie; a silent default about FUEL is a lie inside a spread calculation.
 *
 * Environment:
 *   NOMAD_FUEL_SOURCE          `local` (default) | `wcs`
 *   NOMAD_FUEL_WCS_URL         service endpoint          (required when `wcs`)
 *   NOMAD_FUEL_WCS_COVERAGE    e.g. `fbp100m2026wcs`     (required when `wcs`)
 *   NOMAD_FUEL_WCS_CACHE_DIR   must sit inside a mounted path (required when `wcs`)
 */

export type FuelSource =
  | { readonly kind: 'local' }
  | {
      readonly kind: 'wcs';
      readonly baseUrl: string;
      readonly coverageId: string;
      readonly cacheDir: string;
    };

type Env = Record<string, string | undefined>;

const REQUIRED_WCS_VARS = [
  'NOMAD_FUEL_WCS_URL',
  'NOMAD_FUEL_WCS_COVERAGE',
  'NOMAD_FUEL_WCS_CACHE_DIR',
] as const;

/** Blank is missing. `NOMAD_FUEL_WCS_URL=` looks configured and is not. */
function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function resolveFuelSource(env: Env = process.env): FuelSource {
  const selector = present(env.NOMAD_FUEL_SOURCE)?.toLowerCase() ?? 'local';

  if (selector === 'local') {
    return { kind: 'local' };
  }

  if (selector !== 'wcs') {
    throw new Error(
      `unrecognised fuel source "${selector}" in NOMAD_FUEL_SOURCE: expected "local" or "wcs". ` +
        'Refusing rather than defaulting to local, because the operator asked for something ' +
        'and would otherwise be told nothing.',
    );
  }

  const missing = REQUIRED_WCS_VARS.filter(name => present(env[name]) === undefined);
  if (missing.length > 0) {
    throw new Error(
      `fuel source is set to "wcs" but ${missing.join(', ')} ` +
        `${missing.length === 1 ? 'is' : 'are'} not set. There is NO fallback to local ` +
        'tiles: a run that quietly used a different fuel grid than the one configured would ' +
        'be indistinguishable from a correct one.',
    );
  }

  return {
    kind: 'wcs',
    baseUrl: present(env.NOMAD_FUEL_WCS_URL)!,
    coverageId: present(env.NOMAD_FUEL_WCS_COVERAGE)!,
    cacheDir: present(env.NOMAD_FUEL_WCS_CACHE_DIR)!,
  };
}

/**
 * What goes in the producer field a run records (#431 added that field for
 * exactly this question). It must distinguish the sources: a label that named
 * the WCS unconditionally would misattribute every local run, which is worse
 * than recording nothing.
 */
export function fuelProducerLabel(source: FuelSource): string {
  return source.kind === 'wcs'
    ? `CFS FBP WCS coverage ${source.coverageId}`
    : 'local installed fuel dataset';
}
