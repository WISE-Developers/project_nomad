/**
 * Ratchet guard for #480: no test may hand supertest an express app.
 *
 * Handing `request()` an express app makes supertest call `app.listen(0)` on
 * every single request, creating a fresh client/server port pair each time.
 * That pair can collide, on its full 4-tuple, with a loopback connection
 * belonging to an unrelated process on the machine — and the request is then
 * answered by that stranger, or not at all. See `src/test/sharedServer.ts` for
 * the measurements.
 *
 * WHY A RATCHET AND NOT A FLAT ASSERTION. The defect appears roughly once per
 * 2,400 requests, so a test that exercises it directly would itself be flaky —
 * the thing this issue exists to eliminate. And ~180 call sites cannot convert
 * in one change. So this records a per-file BASELINE and fails if any file
 * exceeds it, or if a file not listed here adopts the pattern. Converting a
 * file means dropping its baseline; a file at 0 is removed from the list.
 *
 * The baselines are MEASURED BY THIS FILE'S OWN COUNTER, which matters: a grep
 * written separately disagreed with it (splash.test.ts, 6 by grep vs 8 here),
 * because the grep missed the bare-identifier form. To regenerate, run this
 * test and read the violations it prints — never a second instrument.
 *
 * This guard can fail. Verified by mutation: adding one `request(buildApp())`
 * to an at-baseline file turns it red, and removing it turns it green again. A
 * guard nobody has watched fail is not known to work.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(import.meta.dirname, '../..');

/**
 * This guard's own path. Its regex literals match themselves, which is not a
 * defect in anything — but an instrument that reports itself as a violation
 * teaches people to ignore it.
 */
const SELF = 'test/__tests__/noPerRequestServer.test.ts';

/**
 * Files still on the old pattern, with the number of occurrences each. Every
 * entry is a debt to pay down, not an exemption.
 *
 * WHAT IS LEFT IS NOT MECHANICAL, which is why it is still here. Each of these
 * builds a BESPOKE app inside the test — `buildApp({ listInstalled })`,
 * `makeApp({ logger })`, `await buildApp()` with per-test env — and then makes
 * ONE request against it. Sharing a server saves nothing when there is one app
 * per request already; the reduction needs the test redesigned so the app is
 * built once and the varying part injected per request. That is a judgement
 * call about test design, not a find-and-replace, so it is recorded as debt
 * rather than quietly exempted.
 *
 * These sites are still exposed. During this very conversion the suite failed
 * twice at unconverted sites: `results.perimeterDownload` returned a 404 with
 * no error body, and `usage.test.ts:174` -- `request(makeApp({ logger: log }))`
 * -- failed with "Parse Error: Expected HTTP/", then passed 6/6 in isolation.
 */
const BASELINE: Record<string, number> = {
  'api/routes/v1/__tests__/usage.integration.test.ts': 7,
  'api/middleware/__tests__/unhonouredIdentity.test.ts': 6,
  'api/routes/v1/__tests__/fuelDatasets.test.ts': 6,
  'api/routes/v1/__tests__/usage.test.ts': 6,
  'api/routes/v1/__tests__/models.acnIdentity.test.ts': 4,
  'api/routes/v1/__tests__/models.listScoping.test.ts': 3,
  'api/routes/v1/__tests__/splash.test.ts': 2,
  'api/__tests__/modelsPreflight.test.ts': 1,
};

/**
 * EVERY `request(` call, with the safe form subtracted — not a pattern for the
 * unsafe form.
 *
 * THIS IS THE SECOND VERSION AND THE FIRST ONE LIED. It matched
 * `request(<identifier>)` and `request(<identifier>())`, which silently missed
 * every parameterised call: `request(makeApp({ query: q }))` has an object
 * argument and did not match. usage.test.ts then DISAPPEARED from the
 * remaining-work list while still holding six sites that create a server per
 * request — and one of them had just failed with "Parse Error: Expected HTTP/".
 * An instrument that under-reports reads exactly like progress.
 *
 * So: count them all, subtract the ones known to pass a listening server. What
 * is left is anything handing supertest something else, whatever its shape.
 */
const OFFENDING = /\brequest\(/g;

/**
 * Call sites that pass a listening server: `request(api())` from `serveOnce`
 * and `request(api(<key>))` from `serveKeyed`.
 */
const ALLOWED = /\brequest\(\s*api\([^)]*\)\s*\)/g;

function testFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'node_modules' && entry !== 'dist') testFiles(full, found);
    } else if (entry.endsWith('.test.ts')) {
      found.push(full);
    }
  }
  return found;
}

function countOffences(file: string): number {
  const text = readFileSync(file, 'utf-8');
  const all = text.match(OFFENDING)?.length ?? 0;
  const ok = text.match(ALLOWED)?.length ?? 0;
  return all - ok;
}

describe('#480 — no test may hand supertest an express app', () => {
  const files = testFiles(SRC);

  it('the control: the scanner finds test files and sees the pattern at all', () => {
    // A scanner pointed at the wrong directory returns zero offences, which is
    // byte-identical to a fully converted suite. This separates them.
    expect(files.length).toBeGreaterThan(50);
    const total = files
      .filter((f) => relative(SRC, f).split(sep).join('/') !== SELF)
      .reduce((n, f) => n + countOffences(f), 0);
    expect(total, 'scanner reports zero offences everywhere — it is probably broken').toBeGreaterThan(0);
  });

  it('no file exceeds its recorded baseline, and no new file adopts the pattern', () => {
    const violations: string[] = [];

    for (const file of files) {
      const key = relative(SRC, file).split(sep).join('/');
      if (key === SELF) continue;
      const count = countOffences(file);
      const allowed = BASELINE[key] ?? 0;
      if (count > allowed) {
        violations.push(
          `${key}: ${count} occurrence(s), baseline ${allowed}` +
            (allowed === 0 ? ' — use serveOnce() from src/test/sharedServer.ts' : ' — went up'),
        );
      }
    }

    expect(violations, `per-request server creation (#480):\n  ${violations.join('\n  ')}`).toEqual([]);
  });

  it('the baseline does not list files that no longer offend, so the debt stays honest', () => {
    const stale = Object.keys(BASELINE).filter((key) => {
      const full = join(SRC, key);
      try {
        return countOffences(full) === 0;
      } catch {
        return true; // file gone — the entry is stale either way
      }
    });

    expect(stale, `these are converted (or absent); remove them from BASELINE:\n  ${stale.join('\n  ')}`).toEqual([]);
  });
});
