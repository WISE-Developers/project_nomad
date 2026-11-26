/**
 * The real GDAL collaborators for `resolveFuelGridForRun` (#282, plan Step 2).
 *
 * Kept apart from the seam so the composition stays testable without GDAL, and so the
 * two different GDAL surfaces this path needs are visible rather than tangled:
 *
 *   - `gdal-async`, the in-process binding, for the coordinate transform and for reading
 *     pixel values. It is already how PerimeterRasterizer and ArrivalTimeTileGenerator
 *     read rasters, so this adds no new dependency.
 *   - `gdalwarp`, the CLI, for the reprojection — because `buildFuelWarpArgs` returns an
 *     argv for it, and the argv form is what keeps paths with spaces unquoted and
 *     uninjectable.
 *
 * THOSE TWO CAN DISAGREE ABOUT WHETHER GDAL IS PRESENT, which is why a missing CLI is
 * reported as exactly that, naming the binary, rather than as a fuel error. They did
 * disagree on this macOS host from 2026-11-05 to 2026-11-20: the binding loaded fine
 * while every Homebrew GDAL binary failed to link. Resolved 2026-11-23 — the CLI is
 * GDAL 3.13.3 and the binding 3.12.3, and both work. The dev container's GDAL 3.6.2
 * works too, which is where this path ran while the host's was broken.
 */

import { spawn } from 'node:child_process';

/** The coverage's native CRS. Stated once; the WCS serves only this. */
const COVERAGE_EPSG = 3978;

/**
 * WGS84 to the coverage CRS, in projected metres.
 *
 * `fromEPSG(4326)` does not transform correctly in this binding — the existing fuel-grid
 * lookup carries the same note and the same proj4 workaround, so this matches it rather
 * than inventing a second convention.
 */
export async function toEpsg3978(
  latitude: number,
  longitude: number
): Promise<{ x: number; y: number }> {
  const gdal = (await import('gdal-async')).default;
  const wgs84 = gdal.SpatialReference.fromProj4('+proj=longlat +datum=WGS84 +no_defs');
  const target = gdal.SpatialReference.fromEPSG(COVERAGE_EPSG);
  const transform = new gdal.CoordinateTransformation(wgs84, target);
  const point = transform.transformPoint(longitude, latitude);
  return { x: point.x, y: point.y };
}

/**
 * Every DISTINCT pixel value in band 1.
 *
 * Distinct rather than all of them: both guards take a set — "which values are present"
 * — and a 20 km window at 100 m is 40,000 pixels whose full list says nothing extra.
 */
export async function readGridValues(path: string): Promise<number[]> {
  const gdal = (await import('gdal-async')).default;
  const ds = await gdal.openAsync(path);
  try {
    const band = ds.bands.get(1);
    const { x, y } = ds.rasterSize;
    const pixels = band.pixels.read(0, 0, x, y) as unknown as ArrayLike<number>;
    const seen = new Set<number>();
    for (let i = 0; i < pixels.length; i += 1) {
      seen.add(pixels[i]);
    }
    return [...seen];
  } finally {
    ds.close();
  }
}

/**
 * A raster's DECLARED EPSG code (#563).
 *
 * This exists so the reprojection target is read off the raster FireSTARR pairs the fuel
 * with — the companion DEM — rather than composed from a UTM zone by code of ours.
 * #282's D9 check asserted the produced grid's CRS equalled `utmEpsgForZone(zone)` and
 * PASSED, while the engine answered `Grids are not aligned`: it compared our code against
 * our own constant. The installed dataset is NAD83 / UTM (26900 + zone), verified on
 * zones 10 and 11.
 *
 * THROWS RATHER THAN RETURNING A FALLBACK, in all three ways this can be unreadable: no
 * spatial reference at all, no authority code, and an authority that is not EPSG. A
 * number returned on a guess would be warped to confidently and land nowhere, and every
 * artefact in the run would still say the WCS had been used.
 */
export async function readRasterEpsg(path: string): Promise<number> {
  const gdal = (await import('gdal-async')).default;
  const ds = await gdal.openAsync(path);
  try {
    const srs = ds.srs;
    if (!srs) {
      throw new Error(
        `${path} declares no spatial reference, so there is no CRS to align the fuel grid ` +
          'to. Refusing rather than assuming one.'
      );
    }
    const authority = srs.getAuthorityName(null);
    const code = srs.getAuthorityCode(null);
    if (authority !== 'EPSG' || !code) {
      throw new Error(
        `${path} declares its CRS as ${authority ?? 'an unnamed authority'}:` +
          `${code ?? 'no code'}, not an EPSG code. Refusing rather than guessing one: ` +
          'gdalwarp would accept a wrong -t_srs and produce a confident raster in the ' +
          'wrong place.'
      );
    }
    const epsg = Number(code);
    if (!Number.isInteger(epsg) || epsg <= 0) {
      throw new Error(`${path} declares EPSG code "${code}", which is not a positive integer.`);
    }
    return epsg;
  } finally {
    ds.close();
  }
}

/** A raster's origin, pixel size and dimensions — everything alignment is judged on. */
export interface RasterGrid {
  readonly originX: number;
  readonly originY: number;
  readonly width: number;
  readonly height: number;
  readonly pixelW: number;
  readonly pixelH: number;
}

/**
 * The geotransform and size of a raster, for snapping a DEM onto a fuel grid (#563).
 *
 * `pixelH` IS RETURNED POSITIVE. GDAL's geoTransform[5] is normally NEGATIVE, because
 * row order runs north to south, and passing that straight through would compute the
 * window's southern edge by ADDING height — placing the clip one full grid north of the
 * fuel and producing `FATAL: Grids are not aligned` from code that looked arithmetically
 * fine. The sign is normalised here, once, rather than at each use.
 *
 * REFUSES A ROTATED RASTER rather than ignoring the rotation terms. geoTransform[2] and
 * [4] are zero for every north-up grid; non-zero means the pixel axes are not aligned
 * with the CRS axes, and an origin-plus-size window does not describe such a raster at
 * all. Silently dropping them would clip confidently to the wrong ground.
 */
export async function readRasterGrid(path: string): Promise<RasterGrid> {
  const gdal = (await import('gdal-async')).default;
  const ds = await gdal.openAsync(path);
  try {
    const gt = ds.geoTransform;
    if (!gt) {
      throw new Error(
        `${path} has no geotransform, so it has no origin or cell size to align to. ` +
          'Refusing rather than assuming one.'
      );
    }
    if (gt[2] !== 0 || gt[4] !== 0) {
      throw new Error(
        `${path} is a rotated raster (geotransform shear terms ${gt[2]}, ${gt[4]}). An ` +
          'origin-and-size window cannot describe it, so clipping a DEM to it would ' +
          'produce a confident raster over the wrong ground.'
      );
    }
    const { x, y } = ds.rasterSize;
    return {
      originX: gt[0],
      originY: gt[3],
      width: x,
      height: y,
      pixelW: Math.abs(gt[1]),
      // Normalised positive. See the header — this sign has a failure attached to it.
      pixelH: Math.abs(gt[5]),
    };
  } finally {
    ds.close();
  }
}

/**
 * Runs `gdalwarp` with a prepared argv.
 *
 * Non-zero exit carries stderr into the message. GDAL reports a projection refusal and a
 * missing file in the same exit code, so the text is the only thing that tells them apart.
 */
export async function warp(args: string[], binary = 'gdalwarp'): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      reject(
        new Error(
          err.code === 'ENOENT'
            ? `${binary} is not on PATH, so the fuel grid cannot be reprojected. This is a ` +
              'missing GDAL CLI, not a fuel data problem.'
            : `${binary} could not be started: ${err.message}`
        )
      );
    });
    child.on('close', (code: number | null) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${binary} exited ${code ?? 'with no status'} while reprojecting the fuel grid. ` +
            `stderr: ${stderr.trim() || '(empty)'}`
        )
      );
    });
  });
}
