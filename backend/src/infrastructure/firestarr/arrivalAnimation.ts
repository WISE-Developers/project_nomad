import { execSync } from 'child_process';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseIsoToDate } from '../../shared/dateParsing.js';

/**
 * Arrival-perimeter animation helpers (refs #236).
 *
 * Builds the list of hourly frames the animation will render. One frame per
 * simulation hour starting at offset 1 (offset 0 is pre-ignition and has no
 * perimeter). Capped at 168 frames (7 days) so long sims stay bounded.
 */

export interface AnimationFrame {
  /** Hours elapsed from simulation start. */
  offsetHours: number;
  /** Wall-clock time of this frame in ISO 8601 (UTC). */
  isoTime: string;
}

export interface AnimationFeatureProperties {
  offsetHours: number;
  isoTime: string;
}

export interface GeoJSONGeometry {
  type: string;
  coordinates: unknown;
}

export interface RawPolygonizedFeature {
  type: 'Feature';
  properties: { DN: number };
  geometry: GeoJSONGeometry;
}

export interface RawPolygonizedFeatureCollection {
  type: 'FeatureCollection';
  features: RawPolygonizedFeature[];
}

export interface AnimationFeature {
  type: 'Feature';
  properties: AnimationFeatureProperties;
  geometry: GeoJSONGeometry;
}

export interface AnimationFeatureCollection {
  type: 'FeatureCollection';
  features: AnimationFeature[];
}

/**
 * Transforms the raw GeoJSON produced by `gdal_polygonize` on the reclassified
 * arrival raster into the animation response shape consumed by the frontend.
 *
 *  - Drops DN=0 features (unburned cells emit a background polygon we don't
 *    want in the animation).
 *  - Renames the DN property to `offsetHours` and adds a wall-clock `isoTime`
 *    derived from the sim start so the slider can label frames without
 *    recomputing time on the client.
 *  - Preserves geometry verbatim; simplification/reprojection happens upstream
 *    in the GDAL pipeline.
 */
/**
 * Dependencies injected into extractArrivalAnimation so the orchestrator can
 * be unit-tested without spawning real GDAL processes. Production wires
 * these to execSync, mkdtempSync, fs.readFileSync + JSON.parse, and rm -rf.
 */
export interface AnimationExtractorDeps {
  /** Runs a shell command synchronously; throws on non-zero exit. */
  exec: (command: string) => void;
  /** Creates a unique temp directory with the given prefix; returns path. */
  mkdtemp: (prefix: string) => string;
  /** Reads a JSON file from disk and parses it. */
  readJSON: (path: string) => unknown;
  /** Recursively removes a directory (best-effort cleanup). */
  rmrf: (path: string) => void;
}

export interface ExtractArrivalAnimationParams {
  arrivalPath: string;
  simStart: Date;
  durationHours: number;
  capFrames?: number;
}

/**
 * Orchestrates the GDAL pipeline that turns a FireSTARR arrival-time raster
 * into a FeatureCollection of per-hour perimeter polygons (refs #236):
 *
 *   arrival.tif --(gdal_calc)--> classified.tif
 *                              --(gdal_polygonize)--> frames.gpkg
 *                              --(ogr2ogr)--> frames.geojson (WGS84)
 *
 * Each classified pixel's value is the 1-based frame index (the hour in which
 * the pixel ignited). gdal_polygonize emits one feature per contiguous
 * same-value region, which toAnimationFeatureCollection then tags with
 * offsetHours + isoTime. All temp files land in a single directory that is
 * removed in the `finally` block, even on failure.
 */
export async function extractArrivalAnimation(
  params: ExtractArrivalAnimationParams,
  deps: AnimationExtractorDeps,
): Promise<AnimationFeatureCollection> {
  const capFrames = params.capFrames ?? DEFAULT_FRAME_CAP;
  const tmpDir = deps.mkdtemp('nomad-anim-');
  try {
    const classifiedPath = `${tmpDir}/classified.tif`;
    const vectorPath = `${tmpDir}/frames.gpkg`;
    const geojsonPath = `${tmpDir}/frames.geojson`;

    // Anchor the reclassify to the user-configured sim start (from
    // output-config.json's timeRange.start). FireSTARR writes arrival
    // values in 0-indexed Julian days (Jan 1 = 0.0) inside the raster,
    // so we MUST convert our 1-indexed simStart through
    // toFireSTARRRasterJulianDay — otherwise gdal_calc compares against
    // a value 24h ahead and the first day of spread gets bucketed as
    // DN <= 0 and dropped (refs #236 follow-up).
    const simStartJulian = toFireSTARRRasterJulianDay(params.simStart);
    const expression = buildReclassifyExpression(simStartJulian, capFrames);

    deps.exec(
      `gdal_calc.py -A "${params.arrivalPath}" --outfile="${classifiedPath}" ` +
        `--calc="${expression}" --type=Int32 --NoDataValue=0 --quiet`,
    );

    deps.exec(
      `gdal_polygonize.py "${classifiedPath}" -f GPKG "${vectorPath}" frames DN`,
    );

    // gdal_polygonize writes the source raster's SRS into the GPKG, so
    // ogr2ogr reads it from the file directly. Earlier versions passed
    // `-s_srs "<wkt>"` from gdalsrsinfo, which broke when modern PROJ
    // emitted multi-line WKT (Apr 27 2026 staging regression — PR #255 +
    // follow-up): shell-arg splitting mangled the WKT and ogr2ogr aborted
    // with "Failed to process SRS definition", producing a 0-byte GeoJSON.
    deps.exec(
      `ogr2ogr -f GeoJSON "${geojsonPath}" "${vectorPath}" -t_srs EPSG:4326`,
    );

    const raw = deps.readJSON(geojsonPath) as RawPolygonizedFeatureCollection;
    return toAnimationFeatureCollection(raw, params.simStart);
  } finally {
    deps.rmrf(tmpDir);
  }
}

/**
 * Default dependencies backed by the real filesystem and GDAL CLI tools.
 * Used by the HTTP route; unit tests substitute mocks.
 */
export function defaultAnimationExtractorDeps(): AnimationExtractorDeps {
  return {
    exec: (command) => {
      execSync(command, { encoding: 'utf8', stdio: 'pipe' });
    },
    mkdtemp: (prefix) => mkdtempSync(join(tmpdir(), prefix)),
    readJSON: (path) => JSON.parse(readFileSync(path, 'utf-8')),
    rmrf: (path) => {
      try {
        execSync(`rm -rf "${path}"`, { stdio: 'pipe' });
      } catch {
        /* best-effort cleanup */
      }
    },
  };
}

/**
 * Normalises the raw `gdalsrsinfo -o wkt <raster>` stdout into a single
 * WKT string suitable for passing to `ogr2ogr -s_srs`.
 *
 * Two real-world formats are observed depending on PROJ version:
 *
 *   - **Old PROJ (≤ 6, e.g. older macOS Homebrew gdal):** entire WKT on
 *     one line, no leading blank. Trim whitespace and we're done.
 *   - **New PROJ (≥ 7, e.g. Debian gdal 3.6+ used in our containers):**
 *     a blank line, then a 30+ line pretty-printed PROJCRS block.
 *
 * The previous implementation took only the first line of stdout, which
 * worked by accident for old PROJ but returned the empty leading line for
 * new PROJ — ogr2ogr then errored with "Failed to process SRS definition"
 * and the animation endpoint 500'd. Apr 27 2026 staging regression.
 *
 * ogr2ogr accepts multi-line WKT, so we keep the full block; we just trim
 * the leading/trailing whitespace.
 */
export function parseSrsWktOutput(rawOutput: string): string {
  return rawOutput.replace(/\r/g, '').trim();
}

export function toAnimationFeatureCollection(
  raw: RawPolygonizedFeatureCollection,
  simStart: Date,
): AnimationFeatureCollection {
  const startMs = simStart.getTime();
  const features: AnimationFeature[] = [];
  for (const feature of raw.features) {
    const dn = feature.properties?.DN;
    if (typeof dn !== 'number' || dn === 0) continue;
    features.push({
      type: 'Feature',
      properties: {
        offsetHours: dn,
        isoTime: new Date(startMs + dn * 3_600_000).toISOString(), // new-date-allowed: epoch ms + offset
      },
      geometry: feature.geometry,
    });
  }
  return { type: 'FeatureCollection', features };
}

export const DEFAULT_FRAME_CAP = 168;

/**
 * Returns the day-of-year (Jan 1 = 1.0) for the given Date, including
 * fractional hours. This is the human/calendar convention (Jun 19 → 170).
 *
 * NOTE: FireSTARR writes a DIFFERENT convention inside the arrival-time
 * raster — values are 0-indexed (Jan 1 = 0.0, so Jun 19 → 169.x).
 * Use `toFireSTARRRasterJulianDay` when comparing this value against raster
 * pixel values. The filename of an arrival raster (e.g. `..._170_arrival.tif`)
 * still uses the 1-indexed convention this function returns.
 */
export function julianDayFromDate(date: Date): number {
  const year = date.getUTCFullYear();
  const yearStartMs = Date.UTC(year, 0, 1, 0, 0, 0, 0);
  return 1 + (date.getTime() - yearStartMs) / 86_400_000;
}

/**
 * Converts our 1-indexed `julianDayFromDate` into FireSTARR's 0-indexed
 * raster-internal Julian day. FireSTARR writes Jan 1 00:00 UTC as 0.0 in
 * arrival rasters; our convention writes it as 1.0. The two are off by
 * exactly one day. Use this when feeding a date into `buildReclassifyExpression`
 * or otherwise comparing against raster pixel values.
 *
 * Empirical proof (Hay River sim, simStart 2023-06-19 19:00 UTC):
 *   julianDayFromDate(simStart) = 170.79167
 *   raster value at simStart pixel = 169.79167  ← FireSTARR's convention
 *   delta = exactly 1.0
 */
export function toFireSTARRRasterJulianDay(date: Date): number {
  return julianDayFromDate(date) - 1;
}

/**
 * Inverse of julianDayFromDate — converts a decimal day-of-year (1.0 = Jan 1
 * 00:00) in the given calendar year back into a UTC Date.
 */
export function julianToDate(julianDay: number, year: number): Date {
  const yearStartMs = Date.UTC(year, 0, 1, 0, 0, 0, 0);
  return new Date(yearStartMs + (julianDay - 1) * 86_400_000); // new-date-allowed: epoch ms math
}

/**
 * Builds the gdal_calc expression that reclassifies an arrival-time raster
 * (band A, decimal Julian days) into a per-pixel frame index (1..capFrames)
 * used by the animation.
 *
 *  - Unburned cells (A=0) emit 0 so gdal_polygonize drops them (NoData).
 *  - Cells with A > 0 but arrival AT or before simStart (warmup growth
 *    around the ignition polygon, plus the ignition cells themselves) are
 *    CLAMPED into frame 1 — they belong to the animation's initial state.
 *    Apr 26 2026: previously dropped by PR #251, which left a visible "halo"
 *    of FireSTARR-side warmup growth missing from the slider's first frame.
 *  - Cells beyond the capFrames window emit 0.
 *  - Cells in (simStart, simStart + capFrames*h] get a 1-based DN.
 */
export function buildReclassifyExpression(
  simStartJulian: number,
  capFrames: number,
): string {
  const raw = `ceil((A-${simStartJulian})*24)`;
  // Clamp to >=1 so pre-warmup cells become DN=1 instead of being dropped.
  const clamped = `maximum(${raw},1)`;
  return (
    `((A>0)*(${clamped}<=${capFrames})*${clamped}).astype(int)`
  );
}

export interface SimTimeRange {
  simStart: Date;
  durationHours: number;
}

/**
 * Extracts the simulation start and duration (in hours) from a parsed model
 * config. Accepts the `{ timeRange: { start, end } }` shape used by both
 * `output-config.json` and `model.json` on disk. Throws on missing or
 * unparseable fields so callers never silently fall back to 0-hour runs.
 */
export function extractSimTimeRange(config: unknown): SimTimeRange {
  const timeRange = (config as { timeRange?: { start?: string; end?: string } } | undefined)
    ?.timeRange;
  if (!timeRange || typeof timeRange.start !== 'string' || typeof timeRange.end !== 'string') {
    throw new Error('Config is missing timeRange.start or timeRange.end');
  }
  let simStart: Date;
  let end: Date;
  try {
    simStart = parseIsoToDate(timeRange.start, 'arrivalAnimation timeRange.start');
    end = parseIsoToDate(timeRange.end, 'arrivalAnimation timeRange.end');
  } catch {
    throw new Error(`Invalid timeRange dates: start=${timeRange.start} end=${timeRange.end}`);
  }
  const durationHours = (end.getTime() - simStart.getTime()) / 3_600_000;
  return { simStart, durationHours };
}

export function computeAnimationFrames(
  simStart: Date,
  durationHours: number,
  capHours: number = DEFAULT_FRAME_CAP,
): AnimationFrame[] {
  const count = Math.max(0, Math.min(Math.floor(durationHours), capHours));
  const startMs = simStart.getTime();
  const frames: AnimationFrame[] = [];
  for (let offset = 1; offset <= count; offset++) {
    frames.push({
      offsetHours: offset,
      isoTime: new Date(startMs + offset * 3_600_000).toISOString(), // new-date-allowed: epoch ms + offset
    });
  }
  return frames;
}
