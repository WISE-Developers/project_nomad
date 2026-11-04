import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFuelLut } from '../fuelGridLut';
import {
  DECODE_LUT_CSV,
  loadDecodeFuelLut,
  assertDecodeTable,
  NON_FUEL_GRID_VALUES,
} from '../fuelDecodeLut';

/**
 * #282 task 3 — the DECODE table, which is not FireSTARR's modelling table.
 *
 * FireSTARR's own fuel.lut gives the non-fuel block burnable fuel types ON
 * PURPOSE: it treats non-fuel as a very slow fuel so that some movement occurs
 * (BadgerOnABike, #282, 2026-11-03). That is correct for MODELLING and wrong for
 * telling a user what a pixel is. Six rows differ - 100, 101, 103, 104, 105,
 * 106 - and 101 and 105 both occur in live coverage windows, so getting this
 * backwards decodes vegetated non-fuel as burnable mixedwood.
 *
 * The table is EMBEDDED rather than read from disk at runtime. `copy:assets`
 * copies only `src/services/splash/assets`, so a .csv under this directory would
 * load in tests and be absent from `dist` - green suite, broken container. The
 * .csv next door is kept as provenance and the first test below ties the two
 * together so they cannot drift.
 */
describe('fuel decode LUT', () => {
  it('the embedded table is exactly the provenance CSV', () => {
    // The drift guard. If someone edits one and not the other, this fails
    // rather than the two quietly disagreeing about what a fuel type is.
    //
    // Line endings are normalised, and that is not laziness: the CFS file is
    // CRLF (150 CRLF pairs, 11800 bytes on disk) while the embedded copy is LF, because
    // the generator read it with universal newlines. Line endings carry no fuel
    // information, and a byte-exact assertion would also break on any checkout
    // whose git autocrlf differs - a CI failure about nothing.
    const onDisk = readFileSync(join(__dirname, '..', 'fuel_updated.csv'), 'utf8');
    const lf = (text: string) => text.replace(/\r\n/g, '\n').trim();
    expect(lf(DECODE_LUT_CSV)).toBe(lf(onDisk));
    // Still a real comparison: the whole table, not a prefix or a row count.
    expect(lf(onDisk).split('\n')).toHaveLength(150);
  });

  it('parses the real CRLF file, because that is what CFS ships', () => {
    // The provenance file is CRLF. If the parser ever stops trimming cells, a
    // trailing \r would ride along on the last column and this catches it.
    const onDisk = readFileSync(join(__dirname, '..', 'fuel_updated.csv'), 'utf8');
    expect(onDisk).toContain('\r\n');
    const fromCrlf = parseFuelLut(onDisk);
    expect(fromCrlf.size).toBe(149);
    expect(fromCrlf.get(105)?.fuelType).toBe('Non-fuel');
    // No cell may retain a carriage return.
    for (const row of fromCrlf.values()) {
      expect(row.fuelType).not.toMatch(/\r/);
      expect(row.descriptiveName).not.toMatch(/\r/);
    }
  });

  it('decodes the whole table, not only the non-fuel block', () => {
    const lut = loadDecodeFuelLut();
    expect(lut.size).toBe(149);
    // Mixedwood percent-conifer is the information the old RGB coverage
    // destroyed, so it is the thing worth asserting survives decoding.
    expect(lut.get(650)?.fuelType).toBe('M-1/M-2 (50 PC)');
    expect(lut.get(675)?.descriptiveName).toBe('Boreal Mixedwood (75% Conifer)');
  });

  it('reads every non-fuel row as Non-fuel', () => {
    const lut = loadDecodeFuelLut();
    for (const gridValue of NON_FUEL_GRID_VALUES) {
      expect(lut.get(gridValue)?.fuelType, `grid_value ${gridValue}`).toBe('Non-fuel');
    }
  });

  it('REJECTS FireSTARR’s modelling table, naming the rows that give it away', () => {
    // The negative control, and the reason this guard exists at all. These six
    // rows are verbatim from FireSTARR's fuel.lut - which is NOT tracked in this
    // repo, so it cannot be a committed fixture and is reproduced here instead.
    const modelling = [
      'grid_value, export_value, descriptive_name, fuel_type, r, g, b, h, s, l',
      '100,100,Not Available,D-2,0,0,0,0,0,0',
      '101,101,Non-fuel,D-2,130,130,130,170,0,130',
      '103,103,Unknown,D-2,0,0,0,0,0,0',
      '104,104,Unclassified,D-1/D-2,0,0,0,0,0,0',
      '105,105,Vegetated Non-Fuel,M-1/M-2 (25 PC),204,204,204,170,0,204',
      '106,106,Urban,D-1/D-2,0,0,0,0,0,0',
      '650,650,Boreal Mixedwood (50% Conifer),M-1/M-2 (50 PC),255,211,127,28,255,191',
    ].join('\n');
    const wrongTable = parseFuelLut(modelling);
    expect(() => assertDecodeTable(wrongTable)).toThrow(/modelling table/i);
    // Must name the offenders, so the failure says WHICH rows rather than only
    // that something is wrong.
    expect(() => assertDecodeTable(wrongTable)).toThrow(/105/);
    expect(() => assertDecodeTable(wrongTable)).toThrow(/101/);
  });

  it('the LOAD path validates, not just the assert function', () => {
    // This test exists because of a mutation result: deleting
    // `assertDecodeTable` from inside `loadDecodeFuelLut` left all seven tests
    // green. The shipped table is valid, so the guard never fired and its
    // removal was unobservable - a guard that cannot fail. Handing the load path
    // a modelling table is what makes it observable.
    const modelling = [
      'grid_value, export_value, descriptive_name, fuel_type',
      '101,101,Non-fuel,D-2',
      '105,105,Vegetated Non-Fuel,M-1/M-2 (25 PC)',
    ].join('\n');
    expect(() => loadDecodeFuelLut(modelling)).toThrow(/modelling table/i);
  });

  it('accepts the decode table it ships with', () => {
    // The discriminating half: a guard that rejected everything would satisfy
    // the test above and be useless.
    expect(() => assertDecodeTable(loadDecodeFuelLut())).not.toThrow();
  });

  it('rejects a table missing a non-fuel row entirely, not just a mislabelled one', () => {
    // An absent row would make `lut.get(105)?.fuelType` undefined, which is not
    // 'Non-fuel' - but it must fail as a MISSING row rather than slipping through
    // some truthiness check.
    const truncated = parseFuelLut(
      [
        'grid_value, export_value, descriptive_name, fuel_type',
        '650,650,Boreal Mixedwood (50% Conifer),M-1/M-2 (50 PC)',
      ].join('\n'),
    );
    expect(() => assertDecodeTable(truncated)).toThrow(/105/);
  });
});
