/**
 * multer advisory-floor check (refs #378).
 *
 * multer is the multipart handler on both upload routes:
 *
 *   api/routes/v1/import.ts          model import
 *   api/routes/v1/perimetersImport.ts perimeter shapefile import
 *
 * Every version at or below 2.2.0 carries five advisories:
 *
 *   GHSA-72gw-mp4g-v24j (7.5) DoS via deeply nested field names
 *   GHSA-wc9g-mqfw-jrwm (7.5) DoS via crafted multipart field names
 *   GHSA-535w-7cp7-47q4 (7.5) DoS via oversized array index in field names
 *   GHSA-3p4h-7m6x-2hcm (5.3) DoS via incomplete cleanup of aborted uploads
 *   GHSA-qvfw-j98x-7q72 (3.7) file size limit bypass via async fileFilter race
 *
 * All five are triggered by the multipart request itself -- field names,
 * aborted transfers, fileFilter timing -- so they fire BEFORE any validation
 * of ours runs. Nothing in this repository can prevent them; only the version
 * underneath can.
 *
 * The size-limit bypass deserves separate mention: both routes configure
 * `limits` on the multer instance, and GHSA-qvfw-j98x-7q72 says that control
 * can be defeated. Any reasoning that treats those limits as a guarantee is
 * wrong until this floor is raised.
 *
 * Same shape as betterAuthCurrency.test.ts (#375) and tzdataCurrency (#366),
 * and for the same reason: a dependency can regress below an advisory floor on
 * any install, and it resolves, imports and works. Only an assertion makes it
 * visible.
 *
 * The resolved version is asserted, not the declared range. `^2.1.1` permits
 * both 2.1.1 (vulnerable) and 2.4.0 (clear) -- the range is not what ships.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Highest version covered by the advisories. Raise only when a NEW advisory
 * raises the ceiling -- never to turn a red test green.
 */
const VULNERABLE_AT_OR_BELOW = '2.2.0';

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

describe('multer advisory floor (#378)', () => {
  it('resolves to a version above the vulnerable ceiling', () => {
    const installed = resolveInstalledVersion('multer');

    expect(
      compareSemver(installed, VULNERABLE_AT_OR_BELOW),
      `multer ${installed} is within the vulnerable range <=${VULNERABLE_AT_OR_BELOW}. ` +
        'It handles every multipart request on both upload routes, and these ' +
        'advisories fire before any of our own validation runs.',
    ).toBeGreaterThan(0);
  });

  it('declares a floor that cannot resolve back into the vulnerable range', () => {
    const range = JSON.parse(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '../../../../../package.json'),
        'utf8',
      ),
    ).dependencies['multer'] as string;

    const floor = range.replace(/^[^0-9]*/, '');

    expect(
      compareSemver(floor, VULNERABLE_AT_OR_BELOW),
      `backend/package.json declares multer "${range}", whose floor ${floor} is ` +
        'within the vulnerable range. A clean install could resolve back below ' +
        'the advisory without anything noticing.',
    ).toBeGreaterThan(0);
  });
});
