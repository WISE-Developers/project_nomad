/**
 * better-auth advisory-floor check, frontend side (refs #375).
 *
 * This is the copy that matters most, and it is not a duplicate of the
 * backend's.
 *
 * `@nomad/frontend` is a published package. EasyMap 3 vendors it and never
 * imports better-auth -- it is installed in their tree because *we* declare
 * it in `frontend/package.json` as a runtime dependency, and their Trivy
 * scan blocks on CRITICAL. That is the exact mechanism that made the
 * maplibre CVE (#372) their problem rather than something they could fix on
 * their own side.
 *
 * So the backend's floor being clear does not protect them. This one does.
 *
 * The package is currently hoisted to the workspace root, so both tests
 * happen to read the same file today. That is an artefact of npm's install
 * layout, not a guarantee -- a future `nohoist`, a differing range, or a
 * peer conflict would give the two workspaces different copies, and then
 * only this assertion would speak for what EasyMap 3 actually receives.
 *
 * Our only import surface is `better-auth/react` in `../authClient.ts`.
 * That narrowness is not protection either: the advisories are in the
 * package we ship, not in the entry point we happen to call.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Highest version covered by GHSA-cq3f-vc6p-68fh and GHSA-2vg6-77g8-24mp.
 * Raise this only when a NEW advisory raises the ceiling -- never to turn a
 * red test green.
 */
const VULNERABLE_AT_OR_BELOW = '1.6.21';

/**
 * Read the manifest off disk. better-auth's `exports` map does not expose
 * `./package.json`, and the package is hoisted above this workspace, so
 * neither `require.resolve` nor a fixed relative path works. Walk up.
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
    'better-auth is not installed. It is a declared runtime dependency of ' +
      'a published package; a missing install is the finding, not a reason to skip.',
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

describe('better-auth advisory floor, as shipped in @nomad/frontend (#375)', () => {
  it('resolves to a version above the vulnerable ceiling', () => {
    const installed = resolveBetterAuthVersion();

    expect(
      compareSemver(installed, VULNERABLE_AT_OR_BELOW),
      `better-auth ${installed} is within the vulnerable range <=${VULNERABLE_AT_OR_BELOW}. ` +
        'This is a runtime dependency of the published @nomad/frontend package, so it ' +
        "installs into every consumer's tree -- including EasyMap 3, whose scan blocks on CRITICAL.",
    ).toBeGreaterThan(0);
  });

  it('declares a floor that cannot resolve back into the vulnerable range', () => {
    const frontendRange = JSON.parse(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '../../../package.json'),
        'utf8',
      ),
    ).dependencies['better-auth'] as string;

    // Consumers install from our published range, not from our lockfile.
    // A vulnerable floor means a consumer's clean install can land on a
    // vulnerable version even when ours does not.
    const floor = frontendRange.replace(/^[^0-9]*/, '');

    expect(
      compareSemver(floor, VULNERABLE_AT_OR_BELOW),
      `frontend/package.json declares better-auth "${frontendRange}", whose floor ` +
        `${floor} is within the vulnerable range. Consumers resolve against this ` +
        'range, not against our lockfile.',
    ).toBeGreaterThan(0);
  });
});
