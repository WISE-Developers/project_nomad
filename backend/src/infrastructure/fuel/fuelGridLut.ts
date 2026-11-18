/**
 * The canonical FBP fuel lookup table, and the guard that every fuel value
 * Nomad reads from the CFS WCS must pass. #282 task 2.
 *
 * WIRED by #282: infrastructure/firestarr/fuelGridForRun.ts calls `assertCanonicalGridValues`
 * on every coverage it fetches, before the reprojection and before the engine sees it.
 * THE BLIND SPOT IS CLOSED: that call is passed the operator-declared
 * NOMAD_FUEL_NODATA_VALUE and exempts it, so a nil pixel and a real grid_value are
 * distinguishable at last — but ONLY because somebody declared which is which. Declare
 * nothing and the getter throws before anything is fetched, so the guard is never run
 * with nothing exempt.
 *
 * WHY THIS EXISTS AT ALL. The WCS serves a single-band Int16 raster whose pixel
 * values are `grid_value` from this table. There is nothing in the response that
 * says so: a corrupted, re-coded or re-palettised coverage would arrive looking
 * exactly like a correct one, and the first place the difference would surface
 * is a fire-behaviour number nobody can trace. So the values are checked against
 * the table before anything consumes them.
 *
 * THE SERVICE DECLARES NO NIL VALUE, SO WE DO. `swe:nilValues` is empty in
 * DescribeCoverage and the GeoTIFF carries no NoData tag (measured 2026-11-04;
 * raised with NFIS by BadgerOnABike). `0` is NOT a row in this table, so by itself a
 * `0` pixel cannot be distinguished from a class we failed to decode, and is
 * REJECTED - mapping it to non-fuel would assert a fire-behaviour fact about a pixel
 * we cannot read, silently, inside a spread calculation.
 *
 * The ONE thing that changes that is an operator naming the value in
 * NOMAD_FUEL_NODATA_VALUE. Then `0` - or whatever they named - is exempt, because a
 * human has said which byte means absent. It is still never MAPPED to non-fuel: it is
 * excluded from the canonical check, not given a fuel type. Absent and non-fuel are
 * different claims, and only one of them is true of a pixel outside the coverage.
 *
 * The live coverage's value is measurably `0` (20,000 all-zero pixels past the data
 * edge, an Int16 band with noDataValue null, measured 2026-11-16, issue comment
 * 6920174616). That measurement is EVIDENCE for what an operator should set; it is
 * deliberately not a default here, because a default would decide on their behalf.
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
 *
 * `nilValue` is the absent-pixel value an OPERATOR declared, via
 * NOMAD_FUEL_NODATA_VALUE (#282). Pixels equal to it are absent, not undecodable, and
 * are not reported. Omitting it means no nil value has been declared, and then nothing
 * is exempt — which is the behaviour this module has always had.
 *
 * It is a parameter rather than a module constant on purpose: which value means "absent"
 * is a property of the coverage being read, not of this table. Baking one in would make
 * a declared nil of 0 and an undecodable 0 the same thing again, permanently.
 */
export function findNonCanonicalValues(
  values: Iterable<number>,
  lut: FuelLut,
  nilValue?: number,
): number[] {
  const offending: number[] = [];
  const seen = new Set<number>();
  for (const value of values) {
    if (lut.has(value) || seen.has(value)) continue;
    if (nilValue !== undefined && value === nilValue) continue;
    seen.add(value);
    offending.push(value);
  }
  return offending;
}

/**
 * Fails the run loudly when a fuel grid carries anything the table does not
 * define. There is deliberately no permissive mode and no substitution.
 *
 * `nilValue` carries the same meaning as in `findNonCanonicalValues`: the declared
 * absent-pixel value, or nothing at all if none has been declared.
 */
export function assertCanonicalGridValues(
  values: Iterable<number>,
  lut: FuelLut,
  nilValue?: number,
): void {
  const offending = findNonCanonicalValues(values, lut, nilValue);
  if (offending.length === 0) return;
  const nilNote =
    nilValue === undefined
      ? 'No nil value is declared, so NO value is exempt: set NOMAD_FUEL_NODATA_VALUE ' +
        'if this coverage marks absent pixels.'
      : `The declared nil value is ${nilValue}; these are not it.`;
  throw new Error(
    `fuel grid carries ${offending.length} value(s) absent from the canonical LUT: ` +
      `${offending.join(', ')}. ` +
      `The grid was NOT decoded. ${nilNote}`,
  );
}
