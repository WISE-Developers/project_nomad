/**
 * THE SEAM. Where a run's fuel grid is chosen, and the only production caller of
 * `resolveFuelSource`, `fetchFuelCoverage`, `loadDecodeFuelLut`,
 * `assertCanonicalGridValues`, `buildFuelWarpArgs` and `assertClassDomainPreserved`.
 * #282, plan Step 2.
 *
 * Until this file existed, those five modules were written, tested and reachable only
 * from their own tests. `scripts/__tests__/fuel_modules_declare_wiring.test.sh` is
 * bidirectional, so the moment this module imported them their wiring disclaimers became
 * failing assertions rather than stale comments, and were rewritten deliberately.
 *
 * IT LIVES HERE, BESIDE ITS CONSUMER, AND NOT IN infrastructure/fuel/ — on purpose. That
 * guard measures "is this module imported from outside the fuel directory" as its proxy
 * for "is it on a production path". A composition root sitting INSIDE the directory it
 * composes would satisfy nothing externally while putting all five modules on a live
 * path, so the proxy would have gone on reporting them unwired and the guard's valuable
 * half would have been silently disabled. Placing the seam with the consumer also points
 * the dependency the right way: firestarr depends on fuel, never the reverse.
 *
 * TWO BRANCHES, AND THE DEFAULT ONE IS THE EXISTING CODE UNTOUCHED.
 * `NOMAD_FUEL_SOURCE` unset or `local` means the local selector decides, exactly as it
 * did before this file (Franco, 2026-11-18: "no its optional, and not a default at this
 * time" — "at this time" being a not-yet rather than a never). The WCS branch runs only
 * when an operator asks for it.
 *
 * THERE IS NO FALLBACK BETWEEN SOURCES, IN EITHER DIRECTION. A misconfigured `wcs`
 * throws. Falling back to local would run a fire model on a grid nobody chose, and the
 * producer field would record the fallback as though it had been the request.
 *
 * ORDER IS LOAD-BEARING in the WCS branch, and each step is ordered against a specific
 * way of being wrong:
 *   1. the nil value is read FIRST, because it is required configuration that throws
 *      when unset, and discovering that after a large download charges the operator for
 *      the lesson;
 *   2. the guard runs BEFORE the warp, because reprojecting an undecodable grid yields a
 *      confident raster full of values that are not fuels;
 *   3. the domain check runs AFTER the warp, because inventing a class is precisely what
 *      a non-nearest kernel does to a classified raster;
 *   4. the REPROJECTED path is what is returned, never the EPSG:3978 download — handing
 *      back the latter is a path that ran and a fire in the wrong place.
 *
 * WHAT THIS MODULE DOES NOT ESTABLISH: that the grid is spatially correct. Every step
 * above can pass on a flipped, shifted or wrong-zone raster. That is Step 3b of the
 * plan (D9) and it needs a real coverage, real GDAL and an independent query.
 */

import { join } from 'node:path';
import { resolveFuelSource, fuelProducerLabel } from '../fuel/fuelSource.js';
import { fetchFuelCoverage, type FuelCoverageFetch } from '../fuel/fuelWcsClient.js';
import { loadDecodeFuelLut } from '../fuel/fuelDecodeLut.js';
import { assertCanonicalGridValues } from '../fuel/fuelGridLut.js';
import { buildFuelWarpArgs, assertClassDomainPreserved } from '../fuel/fuelReproject.js';

/**
 * The local selector found no grid covering the ignition.
 *
 * A named type rather than a message match, because the caller must answer this one
 * case with its own existing, more specific diagnosis (#330's "no fuel coverage here,
 * and here is what IS installed") while reporting every other failure verbatim. Telling
 * them apart by substring would quietly re-route a WCS failure into a message about
 * local tiles the operator never asked for.
 */
export class LocalFuelGridMissingError extends Error {}

export interface FuelGridForRunRequest {
  readonly latitude: number;
  readonly longitude: number;
  readonly modelYear: number;
  /** The run's UTM zone. Stated by the caller, not re-derived here. */
  readonly utmZone: number;
  /** Cell size in metres for the reprojected grid. No default (see fuelReproject). */
  readonly resolutionM: number;
  /**
   * Side length in metres of the square coverage window centred on the ignition.
   *
   * REQUIRED, with no default, and it is the one modelling choice this wiring makes.
   * The local path hands FireSTARR whole tiles, so there was no window to inherit. A
   * default here would silently decide how much ground a fire is allowed to spread
   * across, which is a fire-behaviour decision and not a plumbing one.
   */
  readonly windowM: number;
  /** Where the reprojected grid is written. */
  readonly workingDir: string;
}

export interface FuelGridForRun {
  /** The grid the engine should consume. Reprojected, when the source is the WCS. */
  readonly gridPath: string;
  /** Which source produced it, for the run's own record (#431, plan D4). */
  readonly producer: string;
  readonly source: 'local' | 'wcs';
}

/**
 * The collaborators, injected.
 *
 * They exist so the composition can be tested without a network or GDAL, and so Step
 * 3's harness can observe each stage. Production supplies the real ones; nothing here
 * lets a deployment substitute a different fuel path.
 */
export interface FuelGridForRunDeps {
  /** The existing local selector — FireSTARRInputGenerator.findFuelGridForCoordinates. */
  readonly findLocalGrid: (
    latitude: number,
    longitude: number,
    modelYear: number
  ) => Promise<string | undefined>;
  /** WGS84 to the coverage's native EPSG:3978, in projected metres. */
  readonly toEpsg3978: (latitude: number, longitude: number) => Promise<{ x: number; y: number }>;
  readonly fetchCoverage?: (request: FuelCoverageFetch) => Promise<string>;
  /** Every distinct pixel value in a raster, for the guards. */
  readonly readGridValues?: (path: string) => Promise<number[]>;
  readonly warp?: (args: string[]) => Promise<void>;
  /** EnvironmentService.getFuelNoDataValue — throws when unset, by design (D2). */
  readonly nilValue?: () => number;
  readonly assertCanonical?: typeof assertCanonicalGridValues;
  readonly assertDomain?: typeof assertClassDomainPreserved;
}

type Env = Record<string, string | undefined>;

export async function resolveFuelGridForRun(
  request: FuelGridForRunRequest,
  deps: FuelGridForRunDeps,
  env: Env = process.env
): Promise<FuelGridForRun> {
  // The first production call of resolveFuelSource. It throws on an unrecognised
  // selector and on a `wcs` selection missing its keys, and that throw is the contract.
  const source = resolveFuelSource(env);
  const producer = fuelProducerLabel(source);

  if (source.kind === 'local') {
    const gridPath = await deps.findLocalGrid(
      request.latitude,
      request.longitude,
      request.modelYear
    );
    if (!gridPath) {
      throw new LocalFuelGridMissingError(
        `no local fuel grid contains ${request.latitude}, ${request.longitude} for model year ` +
          `${request.modelYear}. Refusing rather than continuing: the engine would be handed a ` +
          'bare raster root and die reporting only an exit code.'
      );
    }
    return { gridPath, producer, source: 'local' };
  }

  // --- WCS, opt-in only from here down ---------------------------------------------

  const fetchCoverage = deps.fetchCoverage ?? fetchFuelCoverage;
  const readGridValues = deps.readGridValues;
  const warp = deps.warp;
  const assertCanonical = deps.assertCanonical ?? assertCanonicalGridValues;
  const assertDomain = deps.assertDomain ?? assertClassDomainPreserved;
  if (!readGridValues || !warp || !deps.nilValue) {
    throw new Error(
      'the WCS fuel source needs a raster reader, a warp runner and a nil-value source. ' +
        'Refusing rather than skipping the guards that depend on them.'
    );
  }

  // Step 1 of the order above: required configuration, before anything is downloaded.
  const nil = deps.nilValue();

  const centre = await deps.toEpsg3978(request.latitude, request.longitude);
  const half = request.windowM / 2;
  const coveragePath = await fetchCoverage({
    baseUrl: source.baseUrl,
    coverageId: source.coverageId,
    cacheDir: source.cacheDir,
    bbox: {
      minX: centre.x - half,
      maxX: centre.x + half,
      minY: centre.y - half,
      maxY: centre.y + half,
    },
  });

  // Step 2: decode against the canonical table, with the declared nil exempted, BEFORE
  // the warp. loadDecodeFuelLut validates the table itself on the way through.
  const sourceValues = await readGridValues(coveragePath);
  assertCanonical(sourceValues, loadDecodeFuelLut(), nil);

  const targetPath = join(request.workingDir, 'fuel_wcs_utm.tif');
  await warp(
    buildFuelWarpArgs({
      sourcePath: coveragePath,
      targetPath,
      utmZone: request.utmZone,
      resolutionM: request.resolutionM,
    })
  );

  // Step 3: nearest-neighbour cannot invent a class, so anything new means it blended.
  assertDomain(sourceValues, await readGridValues(targetPath));

  // Step 4: the reprojected grid, never the download.
  return { gridPath: targetPath, producer, source: 'wcs' };
}
