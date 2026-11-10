import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseFuelLut,
  findNonCanonicalValues,
  assertCanonicalGridValues,
} from '../fuelGridLut';

/**
 * #282 task 2 — the LUT validator.
 *
 * Every later claim Nomad makes about a fuel value rests on this: that a pixel
 * the WCS returned is a grid_value the canonical table actually defines. The
 * fixture is Brett's real `fuel_updated.csv` (BadgerOnABike, 2026-11-03 on
 * #282), not a hand-built shape, so the test cannot drift from the table the
 * service is decoded against.
 *
 * The UPDATED table is deliberate. FireSTARR's own LUT gives the non-fuel block
 * burnable fuel_types on purpose — it treats non-fuel as a very slow fuel so
 * that some movement occurs — which is correct for MODELLING and wrong for
 * display. These two jobs never share a table.
 */
const LUT_CSV = readFileSync(join(__dirname, '..', 'fuel_updated.csv'), 'utf8');

describe('fuel grid LUT', () => {
  it('parses the real canonical table', () => {
    const lut = parseFuelLut(LUT_CSV);
    expect(lut.size).toBe(149);
    // Spot-check a mixedwood row, because percent-conifer is the information
    // the old RGB coverage destroyed and the values coverage restored.
    expect(lut.get(650)).toEqual({
      gridValue: 650,
      descriptiveName: 'Boreal Mixedwood (50% Conifer)',
      fuelType: 'M-1/M-2 (50 PC)',
    });
  });

  it('is the UPDATED table, not FireSTARR’s modelling LUT', () => {
    const lut = parseFuelLut(LUT_CSV);
    // FireSTARR's own table reads `M-1/M-2 (25 PC)` here. If this ever reads
    // that, the wrong file has been wired in and non-fuel would decode as
    // burnable mixedwood.
    expect(lut.get(105)?.fuelType).toBe('Non-fuel');
    expect(lut.get(101)?.fuelType).toBe('Non-fuel');
  });

  it('accepts a real censused domain from the live service', () => {
    const lut = parseFuelLut(LUT_CSV);
    // Measured 2026-11-03 from a 20 km window of fbp100m2026wcs.
    const censused = [1, 2, 4, 11, 13, 31, 101, 102, 650];
    expect(findNonCanonicalValues(censused, lut)).toEqual([]);
    expect(() => assertCanonicalGridValues(censused, lut)).not.toThrow();
  });

  it('REJECTS a value absent from the table, and names it', () => {
    const lut = parseFuelLut(LUT_CSV);
    // The negative control. A validator that accepted everything would pass the
    // test above and fail this one.
    expect(findNonCanonicalValues([1, 2, 99999], lut)).toEqual([99999]);
    expect(() => assertCanonicalGridValues([1, 2, 99999], lut)).toThrow(/99999/);
  });

  it('REJECTS 0, because 0 is not a grid_value and cannot be attributed', () => {
    const lut = parseFuelLut(LUT_CSV);
    // The service declares no nil value and 0 is not a LUT row, so a 0 pixel is
    // indistinguishable from a class we failed to decode. It must never pass
    // silently as non-fuel: that asserts a fire-behaviour fact about a pixel we
    // cannot read.
    expect(lut.has(0)).toBe(false);
    expect(findNonCanonicalValues([0], lut)).toEqual([0]);
    expect(() => assertCanonicalGridValues([101, 0], lut)).toThrow(/0/);
  });

  it('reports every offending value once, not just the first', () => {
    const lut = parseFuelLut(LUT_CSV);
    expect(findNonCanonicalValues([7777, 1, 7777, 8888], lut)).toEqual([7777, 8888]);
  });

  it('refuses a table it cannot parse rather than returning an empty one', () => {
    // Fail fast: an empty LUT would make the validator accept nothing and look
    // like a service fault, or - worse, if inverted - accept everything.
    expect(() => parseFuelLut('')).toThrow(/empty/i);
  });

  it('names the MISSING COLUMN when the header is wrong', () => {
    // This assertion exists because the obvious version of it does not work.
    // Asserting only `.toThrow()` on a bad header passes even with the header
    // check deleted: `grid_value` is then not found, every row parses to NaN,
    // and the zero-rows guard throws instead. Proven by mutation - disabling
    // the header check left all seven tests green. Matching the MESSAGE is what
    // distinguishes the two failure paths.
    expect(() => parseFuelLut('not,a,fuel,table\n1,2,3,4')).toThrow(
      /missing required column\(s\): grid_value/,
    );
  });
});
