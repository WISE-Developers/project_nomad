/**
 * #480: no test may hand supertest an express app.
 *
 * Handing `request()` an express app makes supertest call `app.listen(0)` on
 * every request, drawing a port from the OS ephemeral range — the range the OS
 * hands every other process its client source ports. A collision there sends
 * the request to an unrelated process on the machine, which rejects our JSON
 * (400), demands auth (401), lacks the route (404), does not speak HTTP
 * (`HPE_INVALID_CONSTANT`), or accepts and never answers (a 30s stall). One
 * fault, five faces — which is why #480, #405 and #491 were the same defect.
 * See `src/test/sharedServer.ts` for the factorial that established the cause.
 *
 * The suite is now fully converted: every call site passes a listening server
 * from `serveOnce`, `serveKeyed`, `serveForTest` or `serveInTest`, all of which
 * bind below the ephemeral floor. This guard keeps it that way.
 *
 * WHY THE CONTROL CHANGED, which is the part worth reading.
 *
 * The previous version used `total offences > 0` as its control, to catch a
 * scanner pointed at the wrong directory — such a scanner reports zero
 * offences, which was indistinguishable from a healthy suite. That control was
 * correct right up until the suite was fully converted, at which point zero
 * became the CORRECT answer and the control would have failed for the best
 * possible reason.
 *
 * So the control is now a self-test against fixture strings whose answers are
 * known, in both directions. That separates "detector works" from "detector
 * blind" without depending on the repo still containing violations — the shape
 * it should have had from the start: an instrument verified against a known
 * positive, not against the thing it is measuring.
 *
 * The regex history is worth keeping too. An earlier version pattern-matched
 * the UNSAFE form and silently missed every parameterised call:
 * `request(makeApp({ query: q }))` has an object argument and did not match. A
 * file then DISAPPEARED from the remaining-work list while still holding six
 * live sites, and a whole 15-site file was never listed at all. Counting every
 * `request(` and subtracting the known-safe forms is deliberate — an instrument
 * that under-reports reads exactly like progress.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(import.meta.dirname, '../..');

/** This file's own regex literals and fixtures match themselves. */
const SELF = 'test/__tests__/noPerRequestServer.test.ts';

/**
 * Files still on the old pattern. EMPTY, and it should stay that way — an entry
 * here would be a regression, not an exemption.
 */
const BASELINE: Record<string, number> = {};

/** Every `request(` call. */
const OFFENDING = /\brequest\(/g;

/**
 * The forms that pass an already-listening server:
 *   `request(api())`              — serveOnce / serveForTest
 *   `request(api(<key>))`         — serveKeyed
 *   `request(serveInTest(<app>))` — an app built inside the test body
 */
const ALLOWED = /\brequest\(\s*(?:api\([^)]*\)|serveInTest\([^;]*?\))\s*\)/g;

function countOffences(text: string): number {
  const all = text.match(OFFENDING)?.length ?? 0;
  const ok = text.match(ALLOWED)?.length ?? 0;
  return all - ok;
}

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

describe('#480 — no test may hand supertest an express app', () => {
  const files = testFiles(SRC).filter((f) => relative(SRC, f).split(sep).join('/') !== SELF);

  it('CONTROL: the detector flags unsafe calls and clears safe ones', () => {
    // Known positives — a detector that cannot see these is worthless.
    expect(countOffences('await request(buildApp()).get("/x")')).toBe(1);
    expect(countOffences('await request(app).get("/x")')).toBe(1);
    expect(countOffences('await request(makeApp({ logger: log })).get("/x")')).toBe(1);

    // Known negatives — and a detector that flagged these would block the fix.
    expect(countOffences('await request(api()).get("/x")')).toBe(0);
    expect(countOffences("await request(api('dylan')).get('/x')")).toBe(0);
    expect(countOffences('await request(serveInTest(app)).get("/x")')).toBe(0);
  });

  it('CONTROL: the scanner is actually reading the suite', () => {
    // Distinct from the detector self-test: this catches a scanner pointed
    // somewhere empty, which would otherwise report a spotless suite.
    expect(files.length).toBeGreaterThan(50);
    const totalCalls = files.reduce(
      (n, f) => n + (readFileSync(f, 'utf-8').match(OFFENDING)?.length ?? 0),
      0,
    );
    expect(totalCalls, 'no request() calls found anywhere — the scanner is blind').toBeGreaterThan(100);
  });

  it('no file hands supertest an express app', () => {
    const violations: string[] = [];

    for (const file of files) {
      const key = relative(SRC, file).split(sep).join('/');
      const count = countOffences(readFileSync(file, 'utf-8'));
      const allowed = BASELINE[key] ?? 0;
      if (count > allowed) {
        violations.push(
          `${key}: ${count} occurrence(s) — pass a listening server instead ` +
            '(serveOnce / serveKeyed / serveForTest / serveInTest from src/test/sharedServer.ts)',
        );
      }
    }

    expect(violations, `per-request server creation (#480):\n  ${violations.join('\n  ')}`).toEqual([]);
  });

  it('the baseline is empty, so a regression cannot hide behind an allowance', () => {
    expect(BASELINE).toEqual({});
  });
});
