/**
 * Fetches a clipped fuel coverage from the CFS FBP WCS. #282 task 1.
 *
 * NOT YET WIRED, AND THAT IS THE CORRECT STATE. No production file outside this
 * directory imports this module: every reference today is in its own test. #282 is
 * what connects it to a run, and #282 is parked upstream on NFIS declaring a NoData
 * value for the served coverage (BadgerOnABike raised it with them, #282, 2026-11-03).
 * Until that lands, a run cannot tell an absent pixel from a real fuel class, so
 * wiring this in would mean inventing one.
 *
 * DELETE THIS PARAGRAPH WHEN #282 WIRES IT UP. It is not decoration:
 * scripts/__tests__/fuel_modules_declare_wiring.test.sh fails on a module that has
 * acquired a production importer while still claiming to be unwired, so the note
 * cannot quietly outlive the condition it describes (#523).
 * WHAT THE SERVICE ACTUALLY DOES, measured rather than read from the spec:
 *   - `GetCapabilities` advertises `fbp100m2026wcs` and `fbp30m2026wcs` only.
 *   - Both return a single-band Int16 GeoTIFF, native EPSG:3978, pixel values
 *     being canonical `fuel.lut` grid_value. 100 m grid is 53520 x 35730.
 *   - `DescribeCoverage` advertises `axisLabels="x y"`, so subsets are
 *     `subset=x(min,max)` and `subset=y(min,max)` in projected metres.
 *   - A window outside the coverage is refused with HTTP 400 rather than padded.
 *
 * WE DO NOT ASK THE SERVER TO REPROJECT. `outputCrs` works, and the
 * reprojection is nearest-neighbour so it invents no classes - but it returns
 * the same pixel COUNT stretched over the reprojected extent, so a 10 km
 * request came back at 132 m from a 100 m source. Reprojection is done locally
 * at an explicit resolution instead (#282 condition 4).
 *
 * NOTHING HERE DECODES PIXELS. Validating that the values are canonical is
 * `fuelGridLut`'s job, and it must run before anything consumes the raster.
 */

export interface FuelBbox3978 {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface FuelCoverageRequest {
  readonly baseUrl: string;
  readonly coverageId: string;
  readonly bbox: FuelBbox3978;
}

export interface FuelCoverageFetch extends FuelCoverageRequest {
  /**
   * Where the GeoTIFF is written. Required, with no default: a default would
   * put the file wherever the process happens to be running, outside the paths
   * the dev container mounts, and FireSTARR would later report "file not found"
   * rather than a missing mount.
   */
  readonly cacheDir: string;
}

/** TIFF magic: little-endian `II*\0` and big-endian `MM\0*`. */
const TIFF_MAGIC_LE = [0x49, 0x49, 0x2a, 0x00];
const TIFF_MAGIC_BE = [0x4d, 0x4d, 0x00, 0x2a];

function assertUsableBbox(bbox: FuelBbox3978): void {
  if (bbox.maxX < bbox.minX || bbox.maxY < bbox.minY) {
    throw new Error(
      `inverted bbox: minX/minY must not exceed maxX/maxY, got ` +
        `x(${bbox.minX},${bbox.maxX}) y(${bbox.minY},${bbox.maxY}). ` +
        'Refusing rather than swapping: a swap returns a plausible raster for a window ' +
        'nobody asked for.',
    );
  }
  if (bbox.maxX === bbox.minX || bbox.maxY === bbox.minY) {
    throw new Error(
      `bbox has no area on at least one axis: x(${bbox.minX},${bbox.maxX}) ` +
        `y(${bbox.minY},${bbox.maxY})`,
    );
  }
}

export function buildGetCoverageUrl({ baseUrl, coverageId, bbox }: FuelCoverageRequest): string {
  assertUsableBbox(bbox);
  const url = new URL(baseUrl);
  url.searchParams.set('SERVICE', 'WCS');
  url.searchParams.set('REQUEST', 'GetCoverage');
  url.searchParams.set('version', '2.0.1');
  url.searchParams.set('CoverageId', coverageId);
  url.searchParams.set('outputformat', 'geotiff');
  // Appended, not set: WCS 2.0 takes one `subset` per axis.
  url.searchParams.append('subset', `x(${bbox.minX},${bbox.maxX})`);
  url.searchParams.append('subset', `y(${bbox.minY},${bbox.maxY})`);
  return url.toString();
}

function looksLikeTiff(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const head = Array.from(bytes.subarray(0, 4));
  return (
    TIFF_MAGIC_LE.every((b, i) => head[i] === b) || TIFF_MAGIC_BE.every((b, i) => head[i] === b)
  );
}

/**
 * Fetches the coverage and writes it, returning the path.
 *
 * The body is checked for TIFF magic before anything touches disk. MapServer
 * can answer HTTP 200 with an OGC exception document, and trusting the status
 * alone would write XML into a file named `.tif` - which surfaces much later as
 * an unreadable raster, with nothing pointing back at this request.
 */
export async function fetchFuelCoverage(request: FuelCoverageFetch): Promise<string> {
  const { cacheDir, coverageId, bbox } = request;
  if (!cacheDir || cacheDir.trim().length === 0) {
    throw new Error(
      'no fuel coverage cache directory configured: refusing to choose one, because it must ' +
        'sit inside a path the container mounts',
    );
  }

  const url = buildGetCoverageUrl(request);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `fuel WCS GetCoverage failed: ${response.status} ${response.statusText} for ` +
        `${coverageId} x(${bbox.minX},${bbox.maxX}) y(${bbox.minY},${bbox.maxY}). ` +
        'A window outside the coverage is refused with 400; nothing was written.',
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!looksLikeTiff(bytes)) {
    const preview = Buffer.from(bytes.subarray(0, 200)).toString('utf8').replace(/\s+/g, ' ');
    throw new Error(
      `fuel WCS returned ${bytes.length} bytes that are not a GeoTIFF, with HTTP ` +
        `${response.status} - likely an OGC exception report served as success. ` +
        `Nothing was written. Body begins: ${preview}`,
    );
  }

  const { mkdir, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  await mkdir(cacheDir, { recursive: true });
  const name =
    `${coverageId}_${bbox.minX}_${bbox.minY}_${bbox.maxX}_${bbox.maxY}.tif`.replace(/-/g, 'm');
  const target = join(cacheDir, name);
  await writeFile(target, bytes);
  return target;
}
