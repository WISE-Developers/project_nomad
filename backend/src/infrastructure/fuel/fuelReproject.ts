/**
 * Reprojects a fuel grid into the run's UTM zone, locally. #282 task 4,
 * and #282's sixth checkbox ("re-project to local UTM central meridian").
 *
 * WIRED by #282: `infrastructure/firestarr/fuelGridForRun.ts` builds this argv and runs
 * gdalwarp on every WCS-sourced grid, then calls `assertClassDomainPreserved` on the
 * result. It is no longer true that every reference lives in this file's own test — the
 * reading that got it filed as dead code (#523). It was never dead; it was early.
 *
 * THE REAL-GDAL TEST BELOW IS STILL THE ONLY ONE IN THE REPOSITORY that runs GDAL
 * binaries rather than mocking them, and it RUNS AND PASSES on this host as of
 * 2026-11-23 (GDAL 3.13.3).
 *
 * It did not, from 2026-11-05 to 2026-11-20: Homebrew's GDAL binaries failed to link
 * (libheif wanted libx265.215 while Homebrew shipped .217, then re2 wanted an abseil
 * that had moved on) while the gdal-async binding loaded fine the whole time. So the two
 * GDAL surfaces disagreed about whether GDAL was present, and `describe.skipIf` turned
 * that into a SKIP — invisible inside a green run, for fifteen days. The reprojection was
 * exercised in the dev container instead.
 *
 * Kept rather than deleted because the skip can return the next time a Homebrew
 * dependency moves, and "2 skipped" in a passing run is not something anyone reads.
 *
 * WHY NOT ASK THE SERVICE. `outputCrs` on the WCS works and is itself
 * nearest-neighbour, so it invents no classes - but it returns the same pixel
 * COUNT stretched over the reprojected extent. A 10 km request in EPSG:3978 came
 * back as 100 x 100 at 132 m from a 100 m source (measured 2026-11-04). The grid
 * coarsens with nothing in the response saying so. Doing it here means the cell
 * size is something we state rather than something we discover.
 *
 * NEAREST ONLY. This is a CLASSIFIED raster: the pixel is a `grid_value`, not a
 * quantity. Averaging fuel codes produces numbers that are not fuels - 101 and
 * 102 average to 101.5, 650 against 102 to 376 - and BadgerOnABike's guidance on
 * #282 is explicit: "Don't do it... The Fuels have rules sets that would not be
 * properly respected in a resample."
 */

/** Northern-hemisphere UTM zone to EPSG. */
export function utmEpsgForZone(zone: number): number {
  if (!Number.isInteger(zone) || zone < 1 || zone > 60) {
    throw new Error(
      `invalid UTM zone ${zone}: must be an integer 1-60. ` +
        'Refusing rather than composing an EPSG code, because 32600 and 32661 are both ' +
        'syntactically valid and neither is a UTM zone - the reprojection would succeed ' +
        'confidently and land nowhere.',
    );
  }
  return 32600 + zone;
}

export interface FuelWarpRequest {
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly utmZone: number;
  /** Cell size in metres. Stated explicitly; there is deliberately no default. */
  readonly resolutionM: number;
  /**
   * The operator-declared absent-pixel value, used as the fill for the parts of the
   * output rectangle the source never covered.
   *
   * REPROJECTING A RECTANGLE PRODUCES A ROTATED QUADRILATERAL, so the output always has
   * corners outside the source footprint, and something must go in them. Left to itself
   * gdalwarp writes 0 there and declares no NoData — measured 2026-11-18 on
   * fbp100m2026wcs, whose fetched window held values 1..675 and no 0 at all, while the
   * reprojected corner read 0.
   *
   * That is only harmless while the declared nil happens to BE 0. Declare -9999 and the
   * corners would still be filled with 0, which is a legitimate grid value, so ground
   * the coverage never described would read as a real fuel class and a fire could spread
   * through it with nothing saying so.
   *
   * Optional only so this stayed additive to callers that predate it; the production
   * seam always supplies it.
   */
  readonly nilValue?: number;
}

/**
 * The argv for `gdalwarp`. Returned as an array rather than a shell string so
 * paths with spaces need no quoting and nothing can be injected through them.
 */
export function buildFuelWarpArgs({
  sourcePath,
  targetPath,
  utmZone,
  resolutionM,
  nilValue,
}: FuelWarpRequest): string[] {
  if (!Number.isFinite(resolutionM) || resolutionM <= 0) {
    throw new Error(
      `invalid resolution ${resolutionM}: must be a positive number of metres. ` +
        'There is no default: a default would silently change the grid a fire model runs on.',
    );
  }
  const epsg = utmEpsgForZone(utmZone);
  return [
    '-t_srs',
    `EPSG:${epsg}`,
    '-tr',
    String(resolutionM),
    String(resolutionM),
    // Nearest, always. See the header: this is a classified raster.
    '-r',
    'near',
    // Keep the integer type; a float output would invite interpolation later.
    '-ot',
    'Int16',
    // `!== undefined`, never a truthiness test: 0 is the value the live coverage uses
    // past its data edge, and `if (nilValue)` would drop exactly that case.
    ...(nilValue !== undefined ? ['-dstnodata', String(nilValue)] : []),
    '-overwrite',
    sourcePath,
    targetPath,
  ];
}

/**
 * Fails when reprojection produced a FUEL CLASS the source did not contain.
 *
 * A SUBSET IS FINE and expected: the reprojected footprint clips corners, so
 * edge classes can disappear. What must never happen is a class appearing -
 * nearest-neighbour cannot invent one, and anything that does has blended.
 *
 * `nilValue` is the operator-declared absent-pixel value, and it is exempt because
 * reprojection LEGITIMATELY introduces absence: the rotated footprint leaves corners the
 * source never covered, and those are filled with the nil. Without this parameter the
 * check failed a correct reprojection on its first real coverage (#282, 2026-11-18),
 * which is the shape where a guard manufactures failures and teaches people to ignore it.
 *
 * Exempting ONE declared value does not blunt the check: a blended kernel produces
 * values that are not the nil - 650 against 102 averages to 376 - and those still fail.
 * Omit the parameter and nothing is exempt, exactly as before.
 */
export function assertClassDomainPreserved(
  sourceValues: Iterable<number>,
  reprojectedValues: Iterable<number>,
  nilValue?: number,
): void {
  const source = new Set(sourceValues);
  if (nilValue !== undefined) source.add(nilValue);
  const invented = [...new Set(reprojectedValues)].filter(value => !source.has(value));
  if (invented.length > 0) {
    throw new Error(
      `reprojection invented ${invented.length} class(es) absent from the source: ` +
        `${invented.join(', ')}. Nearest-neighbour cannot do this, so the resampling kernel ` +
        'blended fuel codes into values that are not fuels.',
    );
  }
}
