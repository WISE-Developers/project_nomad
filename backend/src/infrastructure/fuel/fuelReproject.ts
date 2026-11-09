/**
 * Reprojects a fuel grid into the run's UTM zone, locally. #282 task 4,
 * and #282's sixth checkbox ("re-project to local UTM central meridian").
 *
 * NOT YET WIRED, AND THAT IS THE CORRECT STATE. #282 is what connects it, and #282 is
 * parked upstream on NFIS declaring a NoData value. `buildFuelWarpArgs` has no
 * production caller today: every reference is in this file's own test.
 *
 * Said here because the test below is the ONLY test in the repository that runs real
 * GDAL binaries rather than mocking them, against a real GeoTIFF fixture. That makes the
 * fuel path look verified end to end to anyone auditing GDAL coverage, and it was filed
 * as dead code on exactly that reading (#523). It is not dead; it is early.
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
    '-overwrite',
    sourcePath,
    targetPath,
  ];
}

/**
 * Fails when reprojection produced a class the source did not contain.
 *
 * A SUBSET IS FINE and expected: the reprojected footprint clips corners, so
 * edge classes can disappear. What must never happen is a class appearing -
 * nearest-neighbour cannot invent one, and anything that does has blended.
 */
export function assertClassDomainPreserved(
  sourceValues: Iterable<number>,
  reprojectedValues: Iterable<number>,
): void {
  const source = new Set(sourceValues);
  const invented = [...new Set(reprojectedValues)].filter(value => !source.has(value));
  if (invented.length > 0) {
    throw new Error(
      `reprojection invented ${invented.length} class(es) absent from the source: ` +
        `${invented.join(', ')}. Nearest-neighbour cannot do this, so the resampling kernel ` +
        'blended fuel codes into values that are not fuels.',
    );
  }
}
