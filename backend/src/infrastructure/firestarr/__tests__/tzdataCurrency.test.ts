/**
 * Runtime tzdata currency checks (refs #364, #365, #366).
 *
 * The Northwest Territories and Alberta stop observing DST: from
 * 2026-11-01 02:00 both are UTC-06 year round, and the winter
 * abbreviation becomes CST rather than MST. IANA carries the Alberta
 * change in tzdata 2026c and the NWT change in 2026d.
 *
 * Nothing in this repository can be wrong in a way these tests would
 * catch. `computeUtcOffsetHours` already derives offsets live from
 * `Intl` and never hardcodes them. What these tests assert is the
 * *runtime* underneath it -- the ICU/tzdata snapshot baked into
 * whichever Node image we happen to be running on.
 *
 * That distinction is the point. A stale runtime produces no error and
 * logs nothing; it returns a plausible time that is one hour out. These
 * tests are the only thing that makes that visible.
 *
 * Expect them to FAIL until the deployed image carries tzdata 2026d.
 * A failure here is an infrastructure finding (#365), not a code defect.
 *
 * The existing 2023-dated assertions in timezoneUtils.test.ts remain
 * correct and are deliberately left alone: in 2023 these zones really
 * did observe DST. They document the old rule; these document the new
 * one.
 */

import { describe, it, expect } from 'vitest';
import { computeUtcOffsetHours } from '../timezoneUtils.js';

/**
 * Comfortably past the 2026-11-01 02:00 transition, and in deep winter
 * so there is no argument about which side of a boundary we are on.
 */
const AFTER_TRANSITION = new Date('2026-12-15T19:00:00Z');

/** A second winter, to catch a runtime that only patched the first season. */
const FOLLOWING_WINTER = new Date('2027-01-15T19:00:00Z');

/**
 * The release Nomad actually needs.
 *
 * `America/Edmonton` is the only zone this product is configured for --
 * it is `NOMAD_HOME_TIMEZONE` in `.env.example`, and it covers most of
 * the NWT. Its change landed in **2026c**.
 *
 * `America/Inuvik` is the separately-affected NWT zone and needs
 * **2026d**. Nomad does not reference it anywhere, so asserting it here
 * would hold the suite red over a zone we do not serve. If Inuvik is
 * ever modelled, raise this to '2026d' and add the matching offset
 * assertion.
 */
const REQUIRED_TZDATA = '2026c';

/**
 * Compares IANA release identifiers ("2026a", "2026d", "2027b").
 * Returns a negative number when `a` is older than `b`.
 *
 * Deliberately not a string compare: that happens to work within a year
 * but is the kind of thing that quietly stops working later.
 */
function compareTzdataReleases(a: string, b: string): number {
  const parse = (r: string) => {
    const m = /^(\d{4})([a-z]*)$/.exec(r);
    if (!m) throw new Error(`Unrecognised tzdata release identifier: "${r}"`);
    return { year: Number(m[1]), revision: m[2] };
  };
  const left = parse(a);
  const right = parse(b);
  if (left.year !== right.year) return left.year - right.year;
  return left.revision.localeCompare(right.revision);
}

describe('runtime tzdata currency (NWT/Alberta permanent UTC-06)', () => {
  it('reports -6 for America/Edmonton after the 2026-11-01 transition', () => {
    expect(computeUtcOffsetHours(AFTER_TRANSITION, 'America/Edmonton')).toBe(-6);
  });

  it('still reports -6 for America/Edmonton the following winter', () => {
    expect(computeUtcOffsetHours(FOLLOWING_WINTER, 'America/Edmonton')).toBe(-6);
  });

  it(`runs on tzdata ${REQUIRED_TZDATA} or newer`, () => {
    // Node reports the IANA release its bundled ICU carries. Asserting it
    // directly states the requirement, rather than inferring it from a
    // rendered offset.
    //
    // Not an abbreviation check on purpose. The same 2026c data renders
    // Edmonton's winter as "CST" via zoneinfo on macOS but "MDT" via ICU
    // in node:24-slim -- correct offset either way. Asserting a label
    // would test ICU's naming convention instead of the rule we care
    // about.
    const running = process.versions.tz;
    expect(running, 'runtime did not report a tzdata version').toBeDefined();
    expect(
      compareTzdataReleases(running as string, REQUIRED_TZDATA),
      `runtime carries tzdata ${running}; NWT requires ${REQUIRED_TZDATA} or newer`,
    ).toBeGreaterThanOrEqual(0);
  });
});

describe('historical behaviour is unchanged', () => {
  /**
   * Guards against over-correcting. Whatever we do to make the tests
   * above pass must not rewrite the past: these zones genuinely did
   * observe DST before 2026-11-01, and a model re-run against a 2023
   * fire must still produce 2023's offsets.
   */
  it('still reports -7 for America/Edmonton in winter 2023', () => {
    expect(computeUtcOffsetHours(new Date('2023-01-15T12:00:00Z'), 'America/Edmonton')).toBe(
      -7,
    );
  });

  it('still reports -6 for America/Edmonton in summer 2023', () => {
    expect(computeUtcOffsetHours(new Date('2023-06-19T19:00:00Z'), 'America/Edmonton')).toBe(
      -6,
    );
  });
});
