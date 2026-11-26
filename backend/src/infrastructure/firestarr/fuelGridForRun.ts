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
 *   4. the DEM is cut AFTER the fuel warp, because the window it must match is the
 *      WARPED grid's, measured off that grid — the EPSG:3978 coverage is a different
 *      CRS on a different extent, and snapping to it gives two grids that disagree
 *      while every step reports success;
 *   5. the REPROJECTED path is what is returned, never the EPSG:3978 download — handing
 *      back the latter is a path that ran and a fire in the wrong place.
 *
 * AND BEFORE ANY OF IT: the companion DEM is located and its CRS read, because a run
 * with no DEM cannot be aligned however the coverage turns out, and discovering that
 * after fetching a 20 km window charges the operator for the lesson.
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
import {
  buildFuelWarpArgs,
  buildDemClipArgs,
  assertClassDomainPreserved,
} from '../fuel/fuelReproject.js';

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
  /**
   * The RASTER ROOT the engine must be pointed at, when it is not the installed one.
   *
   * THIS FIELD IS THE DIFFERENCE BETWEEN A PATH THAT RAN AND A FIRE THAT USED IT.
   * FireSTARR is not handed a fuel file — it takes `--raster-root`, a DIRECTORY, and
   * selects its own grid inside it. So fetching, validating and reprojecting a coverage
   * changes nothing on its own: without this, a WCS run would do all of that work and
   * the engine would still read the locally installed tiles, with every artefact in the
   * run saying the WCS had been used. Found by asking D7's fourth question — was the
   * resulting grid the one the ENGINE consumed — rather than only whether the path ran.
   *
   * Undefined for a local run, which keeps using the installed root exactly as before.
   */
  readonly fuelRasterRoot?: string;
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
  /**
   * The installed dataset's DEM tile covering the ignition, or undefined if none does.
   *
   * SEPARATE FROM `findLocalGrid` ON PURPOSE (#563). The WCS branch must not obtain
   * FUEL locally — there is no fallback between sources, in either direction — but it
   * does need elevation, because FireSTARR segfaults on a raster root holding fuel
   * alone: exit 139, no FATAL line, no log, zero bytes on stdout and stderr. That
   * silence is indistinguishable from a crash for any other reason, which is why this
   * dependency is named rather than inherited.
   *
   * SO THE WCS FUEL SOURCE DOES NOT STAND ALONE. It still requires the local dataset
   * for a DEM, and a WCS run outside local coverage cannot be aligned at all.
   */
  readonly findCompanionDem?: (
    latitude: number,
    longitude: number,
    modelYear: number
  ) => Promise<string | undefined>;
  /**
   * A raster's declared EPSG code. Rejects when the raster declares none.
   *
   * Reading it off the DEM is what makes alignment assertable against the raster the
   * engine actually pairs the fuel with, instead of against a constant of ours.
   */
  readonly readRasterEpsg?: (path: string) => Promise<number>;
  /**
   * A raster's origin, cell size and pixel dimensions (#563 step 2).
   *
   * Read off the WARPED fuel grid so the DEM can be cut to that exact window. The
   * fetched coverage is the wrong raster to measure — different CRS, different extent —
   * and snapping to it yields two grids that disagree with every step reporting success.
   */
  readonly readRasterGrid?: (path: string) => Promise<{
    originX: number;
    originY: number;
    width: number;
    height: number;
    pixelW: number;
    pixelH: number;
  }>;
  readonly fetchCoverage?: (request: FuelCoverageFetch) => Promise<string>;
  /** Every distinct pixel value in a raster, for the guards. */
  readonly readGridValues?: (path: string) => Promise<number[]>;
  readonly warp?: (args: string[]) => Promise<void>;
  /** EnvironmentService.getFuelNoDataValue — throws when unset, by design (D2). */
  readonly nilValue?: () => number;
  /** Creates the raster-root directory the reprojected grid is written into. */
  readonly ensureDir?: (path: string) => Promise<void>;
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
  const ensureDir =
    deps.ensureDir ??
    (async (path: string) => {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(path, { recursive: true });
    });
  if (!readGridValues || !warp || !deps.nilValue) {
    throw new Error(
      'the WCS fuel source needs a raster reader, a warp runner and a nil-value source. ' +
        'Refusing rather than skipping the guards that depend on them.'
    );
  }

  // Step 1 of the order above: required configuration, before anything is downloaded.
  const nil = deps.nilValue();

  // #563 Step 1, and it runs BEFORE the download for the same reason the nil does: a run
  // with no companion DEM cannot be aligned however the coverage turns out, and finding
  // that out after fetching a 20 km window charges the operator for the lesson.
  if (!deps.findCompanionDem || !deps.readRasterEpsg || !deps.readRasterGrid) {
    throw new Error(
      'the WCS fuel source needs findCompanionDem, readRasterEpsg and readRasterGrid: ' +
        'FireSTARR requires a DEM co-registered with the fuel grid, the reprojection target ' +
        'is read off that DEM rather than composed from the UTM zone, and the DEM is cut to ' +
        "the warped grid's own measured window. Refusing rather than warping to a CRS " +
        'nothing verified, or handing the engine a root it dies on with no output.'
    );
  }
  const readRasterGrid = deps.readRasterGrid;
  const demPath = await deps.findCompanionDem(
    request.latitude,
    request.longitude,
    request.modelYear
  );
  if (!demPath) {
    throw new Error(
      `no companion DEM in the installed dataset covers ${request.latitude}, ` +
        `${request.longitude} for model year ${request.modelYear}. The WCS serves fuel only, ` +
        'so elevation still comes from the local dataset — the WCS fuel source does not stand ' +
        'alone. Refusing rather than handing the engine fuel alone, which segfaults with no ' +
        'output at all.'
    );
  }
  // Thrown through, not caught: an unreadable CRS is a refusal, never a default. A
  // default here would put a fire on ground nothing verified while every artefact in the
  // run said the WCS had been used.
  const targetEpsg = await deps.readRasterEpsg(demPath);

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

  // THE REPROJECTED GRID IS WRITTEN INTO A RASTER ROOT, not dropped beside the weather
  // file, because that is the shape FireSTARR reads: `{root}/{year|default}/fuel_*.tif`.
  // `default` rather than the model year so the engine finds it whatever year is asked
  // for — the window was cut for THIS run's ignition, so there is no other year it could
  // be. The `_0` suffix is the zone's own central meridian (zone * 6 - 183), which is
  // the zone's own central meridian and what a full-zone UTM reprojection produces; a
  // `_5` half-zone grid cannot arise from this path.
  //
  // CORRECTED FOR #563: this comment used to justify the `_0` by "what reprojecting to
  // utmEpsgForZone always produces". The warp no longer calls utmEpsgForZone at all —
  // the target CRS is read off the companion DEM — so the old wording pointed at code
  // that had stopped existing. The `_0` still holds, for the reason now stated.
  const fuelRasterRoot = join(request.workingDir, 'fuelgrid');
  const targetDir = join(fuelRasterRoot, 'default');
  const targetPath = join(targetDir, `fuel_${request.utmZone}_0.tif`);
  await ensureDir(targetDir);
  await warp(
    buildFuelWarpArgs({
      sourcePath: coveragePath,
      targetPath,
      // Read off the companion DEM, never composed from the zone (#563).
      targetEpsg,
      resolutionM: request.resolutionM,
      // The fill for the corners the rotated footprint leaves uncovered. Told to
      // gdalwarp rather than left to it: unguided it writes 0 and declares no NoData,
      // so a declared nil of anything else would leave real-looking fuel in ground the
      // coverage never described (#282, measured 2026-11-18).
      nilValue: nil,
    })
  );

  // Step 3: nearest-neighbour cannot invent a class, so anything new means it blended —
  // except the nil, which the fill above legitimately introduces.
  assertDomain(sourceValues, await readGridValues(targetPath), nil);

  // Step 4 (#563): THE DEM, CUT TO THE FUEL GRID'S OWN WINDOW.
  //
  // Measured off the WARPED grid, never the fetched coverage: the coverage is EPSG:3978
  // on a different extent, and snapping the DEM to it would produce two rasters that
  // disagree while every step above reported success.
  //
  // The engine needs both in one root. Fuel alone is exit 139 with no output at all;
  // fuel and DEM at different extents is `FATAL: Grids are not aligned`.
  const fuelGrid = await readRasterGrid(targetPath);
  const demTargetPath = join(targetDir, `dem_${request.utmZone}_0.tif`);
  await warp(
    buildDemClipArgs({
      sourcePath: demPath,
      targetPath: demTargetPath,
      // The same CRS the fuel was warped into, which came from this very DEM.
      targetEpsg,
      originX: fuelGrid.originX,
      originY: fuelGrid.originY,
      width: fuelGrid.width,
      height: fuelGrid.height,
      pixelW: fuelGrid.pixelW,
      pixelH: fuelGrid.pixelH,
    })
  );

  // Step 5: the reprojected grid, never the download — and the root the engine must be
  // pointed at, without which none of the above reaches the fire.
  return { gridPath: targetPath, producer, source: 'wcs', fuelRasterRoot };
}
