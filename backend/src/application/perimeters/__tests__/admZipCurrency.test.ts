/**
 * adm-zip advisory-floor check (refs #377).
 *
 * adm-zip parses ZIP archives that arrive from users, on both import routes:
 *
 *   api/routes/v1/import.ts                  model import
 *   application/perimeters/parsePerimeterShapefile.ts  shapefile import
 *
 * Every version at or below 0.6.0 carries three advisories:
 *
 *   GHSA-xcpc-8h2w-3j85 (7.5) crafted ZIP triggers a 4GB memory allocation
 *   GHSA-7q85-xj36-vmfc (7.5) uncontrolled allocation via the DECLARED
 *                             uncompressed size (CVE-2026-39244)
 *   GHSA-vwc7-r8mq-g2x9 (6.5) extraction follows destination symlinks,
 *                             allowing arbitrary file overwrite
 *
 * This is a more direct exposure than the better-auth advisories dealt with in
 * #375, which only applied in OAuth mode. Here the input is an archive an
 * untrusted party uploaded, and the first two advisories describe exactly that
 * shape: a declared size field the parser believes before it has the bytes to
 * justify it.
 *
 * Note the ceiling is 0.6.0 INCLUSIVE, so the fix is 0.6.1 and the upgrade
 * crosses a semver major. The two behaviour changes in 0.6.0 --
 * `extractEntryTo` preserving subdirectories rather than flattening, and
 * `utimes` becoming best-effort -- do not touch us: our entire API surface is
 * `new AdmZip(buffer)`, `getEntries()`, `addFile()` and `toBuffer()`.
 *
 * The resolved version is asserted, not the declared range: `^0.5.17` cannot
 * even reach 0.6.1, so the range has to move too.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Highest version covered by the advisories -- inclusive. Raise only when a
 * NEW advisory raises the ceiling, never to turn a red test green.
 */
const VULNERABLE_AT_OR_BELOW = '0.6.0';

const BACKEND_PACKAGE_JSON = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../package.json',
);

/** Walk up to find the package, which may be hoisted above this workspace. */
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
    `${pkg} is not installed. It is a declared runtime dependency; a missing ` +
      'install is the finding, not a reason to skip the check.',
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

describe('adm-zip advisory floor (#377)', () => {
  it('resolves to a version above the vulnerable ceiling', () => {
    const installed = resolveInstalledVersion('adm-zip');

    expect(
      compareSemver(installed, VULNERABLE_AT_OR_BELOW),
      `adm-zip ${installed} is within the vulnerable range <=${VULNERABLE_AT_OR_BELOW} ` +
        '(GHSA-xcpc-8h2w-3j85, GHSA-7q85-xj36-vmfc, GHSA-vwc7-r8mq-g2x9). It parses ' +
        'archives uploaded by users on both import routes.',
    ).toBeGreaterThan(0);
  });

  it('declares a floor that cannot resolve back into the vulnerable range', () => {
    const range = JSON.parse(readFileSync(BACKEND_PACKAGE_JSON, 'utf8'))
      .dependencies['adm-zip'] as string;

    const floor = range.replace(/^[^0-9]*/, '');

    expect(
      compareSemver(floor, VULNERABLE_AT_OR_BELOW),
      `backend/package.json declares adm-zip "${range}", whose floor ${floor} is ` +
        'within the vulnerable range. Note a caret below 1.0.0 does not widen to ' +
        'the next minor, so "^0.5.x" cannot reach the fix at all.',
    ).toBeGreaterThan(0);
  });

  it('does not carry a separate @types/adm-zip package', () => {
    const pkg = JSON.parse(readFileSync(BACKEND_PACKAGE_JSON, 'utf8'));
    const declared =
      pkg.devDependencies?.['@types/adm-zip'] ?? pkg.dependencies?.['@types/adm-zip'];

    // adm-zip ships its own types.d.ts from 0.6.0. A separate @types package
    // pinned to the 0.5 API then describes a shape the library no longer has,
    // and the compiler believes the wrong one of the two.
    expect(
      declared,
      `@types/adm-zip "${declared}" is still declared. adm-zip ships its own ` +
        'TypeScript definitions from 0.6.0, so the external types are now a ' +
        'second, stale description of the same library.',
    ).toBeUndefined();
  });
});
