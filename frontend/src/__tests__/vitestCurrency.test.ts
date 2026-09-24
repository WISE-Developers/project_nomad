/**
 * vitest advisory-floor check (refs #384).
 *
 * vitest is a direct devDependency in BOTH workspaces. Two advisories apply to
 * the version we declare (^2.1.4):
 *
 *   GHSA-5xrq-8626-4rwp (9.8) Vitest UI server serves arbitrary file read AND
 *                             execute while it is listening          (<3.2.6)
 *   GHSA-82fw-gwwq-j7x9 (5.9) @vitest/mocker path traversal /
 *                             arbitrary file read via redirect mock
 *                                                        (>=2.1.0 <4.1.11)
 *
 * Why a test-only package is guarded like a runtime one: per #382, vitest
 * reaches the PRODUCTION node_modules tree as an optional peer of better-auth.
 * Neither --omit=dev nor --omit=peer excludes it, and `npm ci` installs it from
 * the lockfile. It is not confined to developer machines.
 *
 * The ceiling below is the higher of the two advisory ranges, EXCLUSIVE of the
 * fix: 4.1.11 is the first version clearing both. npm audit suggests 5.0.1, but
 * that is merely `latest` -- it is not the minimum that clears the advisories,
 * and adopting it would cross an extra major for no security gain.
 *
 * Note vitest 4.1.11 declares `vite: "^6.0.0 || ^7.0.0 || ^8.0.0"`, so this
 * cannot be satisfied while vite stays on 5 (#385). The pair moves together.
 *
 * The RESOLVED version is asserted as well as the declared range, because
 * "^2.1.4" cannot reach 4.1.11 at all -- the range has to move too.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Highest version covered by the advisories -- inclusive. Raise only when a
 * NEW advisory raises the ceiling, never to turn a red test green.
 */
const VULNERABLE_AT_OR_BELOW = '4.1.10';

const PACKAGE_JSON = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../package.json',
);

/** Walk up to find the package, which is hoisted to the workspace root. */
function resolveInstalledVersion(pkg: string): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  const { root } = parse(dir);

  while (true) {
    const manifest = join(dir, 'node_modules', pkg, 'package.json');
    if (existsSync(manifest)) {
      return JSON.parse(readFileSync(manifest, 'utf8')).version as string;
    }
    if (dir === root) break;
    dir = dirname(dir);
  }

  throw new Error(
    `${pkg} is not installed. It is a declared devDependency and this suite is ` +
      'running under it; a missing install is the finding, not a reason to skip.',
  );
}

/** Numeric semver compare, prerelease-insensitive. >0 when `a` is newer. */
function compareSemver(a: string, b: string): number {
  const partsOf = (v: string) =>
    v.split('-')[0].split('.').map((n) => Number.parseInt(n, 10));
  const [x, y] = [partsOf(a), partsOf(b)];

  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  }
  return 0;
}

describe('vitest advisory floor, frontend (#384)', () => {
  it('resolves to a version above the vulnerable ceiling', () => {
    const installed = resolveInstalledVersion('vitest');

    expect(
      compareSemver(installed, VULNERABLE_AT_OR_BELOW),
      `vitest ${installed} is within the vulnerable range <=${VULNERABLE_AT_OR_BELOW} ` +
        '(GHSA-5xrq-8626-4rwp CVSS 9.8, GHSA-82fw-gwwq-j7x9). Per #382 this package ' +
        'reaches the production tree as an optional peer of better-auth.',
    ).toBeGreaterThan(0);
  });

  it('declares a floor that cannot resolve back into the vulnerable range', () => {
    const declared = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'))
      .devDependencies?.vitest as string | undefined;

    expect(declared, 'frontend/package.json no longer declares vitest').toBeDefined();

    const floor = (declared as string).replace(/^[^0-9]*/, '');

    expect(
      compareSemver(floor, VULNERABLE_AT_OR_BELOW),
      `frontend/package.json declares vitest "${declared}", whose floor ${floor} is ` +
        'within the vulnerable range. A caret cannot cross a major, so "^2.x" can ' +
        'never resolve to the fix at 4.1.11.',
    ).toBeGreaterThan(0);
  });
});
