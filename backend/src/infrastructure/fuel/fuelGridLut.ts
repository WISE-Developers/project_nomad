/**
 * The canonical FBP fuel lookup table, and the guard that every fuel value
 * Nomad reads from the CFS WCS must pass. #282 task 2.
 *
 * NOT YET WIRED, AND THAT IS THE CORRECT STATE. No production file outside this
 * directory imports this module: every reference today is in its own test. #282 is
 * what connects it, and #282 is parked upstream on NFIS declaring a NoData value --
 * which is this guard's blind spot too, since a nil pixel and a real grid_value are
 * indistinguishable to a validator that has never been told which is which.
 *
 * DELETE THIS PARAGRAPH WHEN #282 WIRES IT UP. It is not decoration:
 * scripts/__tests__/fuel_modules_declare_wiring.test.sh fails on a module that has
 * acquired a production importer while still claiming to be unwired, so the note
 * cannot quietly outlive the condition it describes (#523).
 * WHY THIS EXISTS AT ALL. The WCS serves a single-band Int16 raster whose pixel
 * values are `grid_value` from this table. There is nothing in the response that
 * says so: a corrupted, re-coded or re-palettised coverage would arrive looking
 * exactly like a correct one, and the first place the difference would surface
 * is a fire-behaviour number nobody can trace. So the values are checked against
 * the table before anything consumes them.
 *
 * THE SERVICE DECLARES NO NIL VALUE. `swe:nilValues` is empty in
 * DescribeCoverage and the GeoTIFF carries no NoData tag (measured 2026-11-04;
 * raised with NFIS by BadgerOnABike). `0` is NOT a row in this table, so a `0`
 * pixel cannot be distinguished from a class we failed to decode. It is
 * therefore REJECTED, not mapped to non-fuel - mapping it would assert a
 * fire-behaviour fact about a pixel we cannot read, silently, inside a spread
 * calculation.
 *
 * TWO TABLES, TWO JOBS, NEVER INTERCHANGEABLE. FireSTARR's own `fuel.lut` gives
 * the non-fuel block (100, 101, 103, 104, 105, 106) burnable fuel types on
 * purpose - it treats non-fuel as a very slow fuel so that some movement occurs.
 * That is correct for MODELLING. This module is for DECODING what the service
 * returned, where `105` must read as non-fuel. Substituting either table for the
 * other makes vegetated non-fuel burn as mixedwood.
 */

export interface FuelLutRow {
  readonly gridValue: number;
  readonly descriptiveName: string;
  readonly fuelType: string;
}

export type FuelLut = ReadonlyMap<number, FuelLutRow>;

const REQUIRED_COLUMNS = ['grid_value', 'export_value', 'descriptive_name', 'fuel_type'] as const;

/**
 * Parses the canonical table. Throws rather than returning a partial or empty
 * LUT: an empty table would make every value look non-canonical and read as a
 * service fault, which sends the investigation to the wrong place entirely.
 */
export function parseFuelLut(csv: string): FuelLut {
  const lines = csv.split('\n').filter(line => line.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('fuel LUT is empty: expected a header row and at least one fuel row');
  }

  const header = lines[0].split(',').map(cell => cell.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter(column => !header.includes(column));
  if (missing.length > 0) {
    throw new Error(
      `fuel LUT header is missing required column(s): ${missing.join(', ')}. ` +
        `Found: ${header.join(', ')}`,
    );
  }

  const gridValueAt = header.indexOf('grid_value');
  const nameAt = header.indexOf('descriptive_name');
  const fuelTypeAt = header.indexOf('fuel_type');

  const lut = new Map<number, FuelLutRow>();
  for (const line of lines.slice(1)) {
    const cells = line.split(',').map(cell => cell.trim());
    const gridValue = Number(cells[gridValueAt]);
    if (!Number.isInteger(gridValue)) continue;
    lut.set(gridValue, {
      gridValue,
      descriptiveName: cells[nameAt] ?? '',
      fuelType: cells[fuelTypeAt] ?? '',
    });
  }

  if (lut.size === 0) {
    throw new Error('fuel LUT parsed to zero rows: the table is present but unreadable');
  }
  return lut;
}

/**
 * Every distinct value that the table does not define, in the order first seen.
 * Reports ALL of them rather than the first: a coverage that has gone wrong
 * tends to go wrong in more than one class, and a single-value error message
 * invites fixing one and re-running.
 */
export function findNonCanonicalValues(values: Iterable<number>, lut: FuelLut): number[] {
  const offending: number[] = [];
  const seen = new Set<number>();
  for (const value of values) {
    if (lut.has(value) || seen.has(value)) continue;
    seen.add(value);
    offending.push(value);
  }
  return offending;
}

/**
 * Fails the run loudly when a fuel grid carries anything the table does not
 * define. There is deliberately no permissive mode and no substitution.
 */
export function assertCanonicalGridValues(values: Iterable<number>, lut: FuelLut): void {
  const offending = findNonCanonicalValues(values, lut);
  if (offending.length === 0) return;
  throw new Error(
    `fuel grid carries ${offending.length} value(s) absent from the canonical LUT: ` +
      `${offending.join(', ')}. ` +
      'The grid was NOT decoded. 0 is not a grid_value and is never treated as non-fuel.',
  );
}
