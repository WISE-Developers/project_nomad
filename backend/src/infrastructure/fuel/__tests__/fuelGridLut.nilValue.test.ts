import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseFuelLut,
  findNonCanonicalValues,
  assertCanonicalGridValues,
} from '../fuelGridLut';

/**
 * #282: once a nil value is DECLARED, the guard can finally tell an absent pixel from a
 * fuel class it failed to decode.
 *
 * Until now it could not, and said so in its own header: "a nil pixel and a real
 * grid_value are indistinguishable to a validator that has never been told which is
 * which." So `0` was rejected outright — correctly, because mapping it to non-fuel would
 * assert a fire-behaviour fact about a pixel we cannot read.
 *
 * Declaring the value does NOT relax the guard. Everything the table does not define is
 * still rejected. Exactly one value becomes legitimate, and only because an operator
 * named it in configuration.
 *
 * Same fixture as the sibling test — Brett's real `fuel_updated.csv` — and the present
 * and absent values below are DERIVED from it rather than typed in, so this file cannot
 * drift from the table even if the table changes.
 */
const LUT_CSV = readFileSync(join(__dirname, '..', 'fuel_updated.csv'), 'utf8');
const lut = parseFuelLut(LUT_CSV);

/** Two values the table really defines, taken from the table itself. */
const [PRESENT_A, PRESENT_B] = [...lut.keys()].slice(0, 2);

/** A value the table really does not define, found rather than assumed. */
const ABSENT = (() => {
  for (let candidate = 1; candidate < 100_000; candidate++) {
    if (!lut.has(candidate)) return candidate;
  }
  throw new Error('no absent value found — fixture is not what this test assumes');
})();

/** A second absent value, so "reports ALL of them" is actually exercised. */
const ABSENT_2 = (() => {
  for (let candidate = ABSENT + 1; candidate < 100_000; candidate++) {
    if (!lut.has(candidate)) return candidate;
  }
  throw new Error('no second absent value found');
})();

describe('fuel grid guard with a declared nil value (#282)', () => {
  it('the fixture supports this test: present values differ from absent ones', () => {
    expect(lut.has(PRESENT_A)).toBe(true);
    expect(lut.has(PRESENT_B)).toBe(true);
    expect(lut.has(ABSENT)).toBe(false);
    expect(lut.has(0)).toBe(false);
    expect(ABSENT).not.toBe(ABSENT_2);
  });

  it('does not report the declared nil value as non-canonical', () => {
    expect(findNonCanonicalValues([PRESENT_A, PRESENT_B, -9999], lut, -9999)).toEqual([]);
  });

  it('still reports everything else the table does not define', () => {
    expect(
      findNonCanonicalValues([PRESENT_A, ABSENT, -9999, ABSENT_2], lut, -9999)
    ).toEqual([ABSENT, ABSENT_2]);
  });

  it('accepts 0 as the nil value when 0 is what was declared', () => {
    expect(findNonCanonicalValues([0, PRESENT_A, PRESENT_B], lut, 0)).toEqual([]);
  });

  /**
   * CONTROL, and the heart of it. `0` is only legitimate because somebody declared it.
   * Declaring a DIFFERENT nil must leave `0` rejected, exactly as it is today — otherwise
   * the change has quietly turned "0 is absent" into a permanent rule rather than a
   * configured one.
   */
  it('still rejects 0 when the declared nil is something else', () => {
    expect(findNonCanonicalValues([0, PRESENT_A], lut, -9999)).toEqual([0]);
  });

  /**
   * CONTROL on the other side: with NO nil declared the guard must behave exactly as it
   * does today. This is the assertion that fails if the new parameter is given a default.
   */
  it('rejects 0 when no nil value is declared at all', () => {
    expect(findNonCanonicalValues([0, PRESENT_A], lut)).toEqual([0]);
  });

  it('assertCanonicalGridValues does not throw on declared nil pixels', () => {
    expect(() => assertCanonicalGridValues([PRESENT_A, 0, PRESENT_B], lut, 0)).not.toThrow();
  });

  it('assertCanonicalGridValues still throws on genuine junk beside nil pixels', () => {
    expect(() => assertCanonicalGridValues([PRESENT_A, 0, ABSENT], lut, 0)).toThrow(
      new RegExp(String(ABSENT))
    );
  });

  it('says which nil value was declared when it refuses', () => {
    expect(() => assertCanonicalGridValues([ABSENT], lut, 0)).toThrow(
      /declared nil value is 0/
    );
  });

  it('tells an operator the key to set when no nil is declared', () => {
    expect(() => assertCanonicalGridValues([ABSENT], lut)).toThrow(
      /NOMAD_FUEL_NODATA_VALUE/
    );
  });
});
