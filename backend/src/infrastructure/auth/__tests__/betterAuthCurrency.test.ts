/**
 * better-auth advisory-floor check (refs #375).
 *
 * better-auth is declared as a *runtime* dependency in both
 * `backend/package.json` and `frontend/package.json`. Two advisories apply
 * to every version at or below 1.6.21:
 *
 *   GHSA-cq3f-vc6p-68fh (CVSS 7.6) -- device authorization approve and deny
 *     accept any authenticated session while the user code is pending
 *   GHSA-2vg6-77g8-24mp (CVSS 3.8) -- stale sessions persist after user
 *     deletion across admin, anonymous and SCIM flows
 *
 * Nothing in this repository can be wrong in a way this test would catch.
 * Our own auth code is unaffected by the version underneath it. What this
 * asserts is the *resolved* dependency -- the code that actually ships.
 *
 * That distinction is the point, and it is the same one made in
 * `firestarr/__tests__/tzdataCurrency.test.ts` for tzdata (#366): a
 * dependency that regresses below an advisory floor produces no error and
 * logs nothing. It resolves, it imports, it works. Only an assertion makes
 * it visible.
 *
 * This matters beyond our own repository. EasyMap 3 vendors
 * `@nomad/frontend` and never imports better-auth; it is installed because
 * *we* declare it, and their Trivy scan blocks on CRITICAL. The identical
 * mechanism made the maplibre CVE (#372) their problem rather than ours.
 *
 * The declared range is deliberately NOT what is asserted. `^1.5.5` permits
 * both 1.6.8 (vulnerable) and 1.7.5 (clear); the range is not what ships,
 * the lockfile is. Assert the version on disk.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Highest version covered by the advisories. Anything at or below this is a
 * failure. Raise this only when a NEW advisory raises the ceiling -- never to
 * make a red test go green.
 */
const VULNERABLE_AT_OR_BELOW = '1.6.21';

/**
 * Resolve better-auth's manifest from disk rather than through `require`.
 *
 * better-auth's `exports` map does not expose `./package.json`, so
 * `require.resolve('better-auth/package.json')` throws. The package is also
 * hoisted to the workspace root rather than installed under `backend/`, so a
 * fixed relative path would be wrong too. Walk up until it is found.
 */
function resolveBetterAuthVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  const { root } = parse(dir);

  while (true) {
    const manifest = join(dir, 'node_modules', 'better-auth', 'package.json');
    if (existsSync(manifest)) {
      return JSON.parse(readFileSync(manifest, 'utf8')).version as string;
    }
    if (dir === root) break;
    dir = dirname(dir);
  }

  throw new Error(
    'better-auth is not installed. It is a declared runtime dependency; ' +
      'a missing install is itself the finding, not a reason to skip the check.',
  );
}

/** Numeric semver compare. Returns >0 when `a` is newer than `b`. */
function compareSemver(a: string, b: string): number {
  const partsOf = (v: string) =>
    v.split('-')[0].split('.').map((n) => Number.parseInt(n, 10));
  const [x, y] = [partsOf(a), partsOf(b)];

  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  }
  return 0;
}

describe('better-auth advisory floor (#375)', () => {
  it('resolves to a version above the vulnerable ceiling', () => {
    const installed = resolveBetterAuthVersion();

    expect(
      compareSemver(installed, VULNERABLE_AT_OR_BELOW),
      `better-auth ${installed} is within the vulnerable range <=${VULNERABLE_AT_OR_BELOW} ` +
        '(GHSA-cq3f-vc6p-68fh, GHSA-2vg6-77g8-24mp). This ships to EasyMap 3 ' +
        'via @nomad/frontend and blocks their CRITICAL-gated scan.',
    ).toBeGreaterThan(0);
  });

  it('declares a floor that cannot resolve back into the vulnerable range', () => {
    const backendRange = JSON.parse(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '../../../../package.json'),
        'utf8',
      ),
    ).dependencies['better-auth'] as string;

    // A caret range is only as safe as its floor: `^1.5.5` permits 1.6.8.
    // The floor itself must already be clear of the advisory.
    const floor = backendRange.replace(/^[^0-9]*/, '');

    expect(
      compareSemver(floor, VULNERABLE_AT_OR_BELOW),
      `backend/package.json declares better-auth "${backendRange}", whose floor ` +
        `${floor} is within the vulnerable range. A clean install could resolve ` +
        'back below the advisory without anything noticing.',
    ).toBeGreaterThan(0);
  });
});
