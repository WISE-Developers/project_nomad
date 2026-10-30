/**
 * Arrival Time Extractor
 *
 * Converts arrival-time rasters from deterministic FireSTARR runs into
 * fire perimeter polygons. For each day's arrival grid, all pixels with
 * value > 0 (fire arrived) are polygonalized into a GeoJSON boundary.
 *
 * Uses GDAL command-line tools (gdal_calc.py, gdal_polygonize.py, ogr2ogr).
 */

import { execSync } from 'child_process';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import { Result } from '../../application/common/index.js';
import { ValidationError, NotFoundError } from '../../domain/errors/index.js';
import { isGDALAvailable } from './PerimeterGenerator.js';

/**
 * Extracted info from arrival-time raster filename.
 * Pattern: 000_000001_{julianDay}_arrival.tif
 */
interface ArrivalFileInfo {
  scenario: number;
  julianDay: number;
}

/**
 * Result of extracting a deterministic perimeter from an arrival grid.
 */
export interface DeterministicPerimeter {
  /** Julian day of the simulation */
  julianDay: number;
  /** Date string (YYYY-MM-DD) if derivable from Julian day + start date */
  date: string | null;
  /** GeoJSON polygon representing the fire boundary */
  geojson: Feature<Polygon | MultiPolygon>;
}

/**
 * Result of extracting perimeters from all arrival grids.
 */
export interface DeterministicExtractionResult {
  perimeters: DeterministicPerimeter[];
  totalGrids: number;
  successCount: number;
}

/**
 * Parse arrival-time filename.
 * Pattern: 000_{scenario}_{julianDay}_arrival.tif
 */
function parseArrivalFilename(filename: string): ArrivalFileInfo | null {
  const match = filename.match(/^000_(\d+)_(\d+)_arrival\.tif$/);
  if (!match) return null;
  return {
    scenario: parseInt(match[1], 10),
    julianDay: parseInt(match[2], 10),
  };
}

/**
 * Convert a Julian day to a calendar date, GIVEN a year (#492).
 *
 * Returns null when the year is unknown, and that is the whole point: a Julian
 * day is a position in a year and carries no year of its own. The year comes
 * from the model or it does not exist.
 *
 * This used to take a required `number` and was handed
 * `startYear ?? new Date().getFullYear()`, so a 2023 reconstruction was NAMED
 * with the current year — in the output name an analyst reads, with nothing
 * marking it derived.
 *
 * Exported for its own tests: the surrounding extraction needs GDAL and real
 * rasters, and the arithmetic is the part worth pinning.
 */
export function julianDayToDate(julianDay: number, startYear: number | undefined): string | null {
  if (startYear === undefined) {
    return null;
  }
  try {
    // Build the date in UTC; Julian-day math is calendar-positional, not wall-clock.
    const date = new Date(Date.UTC(startYear, 0, julianDay));
    return date.toISOString().split('T')[0];
  } catch {
    return null;
  }
}

/**
 * Extract fire perimeter polygons from deterministic arrival-time rasters.
 *
 * For deterministic mode (single simulation, scenario 000001):
 * 1. Find the last day's arrival grid (highest Julian day)
 * 2. Threshold: all pixels with value > 0 → burned area
 * 3. Polygonalize → GeoJSON fire boundary
 * 4. Reproject to WGS84 (EPSG:4326)
 *
 * @param workingDir Directory containing arrival-time TIFFs
 * @param startYear Year of the simulation (for Julian day → date conversion)
 */
export async function extractDeterministicPerimeters(
  workingDir: string,
  startYear?: number,
): Promise<Result<DeterministicExtractionResult, ValidationError | NotFoundError>> {

  if (!existsSync(workingDir)) {
    return Result.fail(new NotFoundError('Working directory', workingDir));
  }

  // #492: NOTHING on disk is sniffed for a year any more.
  //
  // This used to regex a year out of line 2 of the weather file. Measured on a
  // running instance: moving the weather year 2023 -> 1999 moved the perimeter
  // NAMES to 1999. That is the fallback #479 established cannot be correct —
  // the weather Date column is a bare LOCAL timestamp, and the zone needed to
  // read it lives in the config file whose absence is what would trigger a
  // fallback. The year is now supplied by the caller from the model's recorded
  // time range, or it stays unknown.

  if (!isGDALAvailable()) {
    return Result.fail(
      new ValidationError('GDAL tools not available', [
        { field: 'gdal', message: 'gdal_calc.py, gdal_polygonize.py, and ogr2ogr must be in PATH' },
      ])
    );
  }

  // Find scenario 1 arrival files (deterministic = single scenario)
  const files = readdirSync(workingDir);
  const arrivalFiles = files
    .filter(f => f.match(/^000_000001_\d+_arrival\.tif$/))
    .map(f => ({ filename: f, info: parseArrivalFilename(f)! }))
    .filter(f => f.info !== null)
    .sort((a, b) => a.info.julianDay - b.info.julianDay);

  if (arrivalFiles.length === 0) {
    return Result.fail(
      new NotFoundError('Arrival-time rasters', workingDir, 'No 000_000001_*_arrival.tif files found')
    );
  }

  console.log(`[ArrivalTimeExtractor] Found ${arrivalFiles.length} arrival grids for scenario 1`);

  const perimeters: DeterministicPerimeter[] = [];
  let successCount = 0;
  // #492: no default. An unknown year stays unknown, and `julianDayToDate`
  // returns null rather than naming a perimeter after today.
  const year = startYear;

  for (const { filename, info } of arrivalFiles) {
    const inputPath = join(workingDir, filename);
    const tmpDir = mkdtempSync(join(tmpdir(), 'nomad-arrival-'));

    try {
      // Step 1: Create binary mask (value > 0 → 1, else 0)
      const maskPath = join(tmpDir, 'mask.tif');
      execSync(
        `gdal_calc.py -A "${inputPath}" --outfile="${maskPath}" --calc="(A>0)*1" --type=Byte --NoDataValue=0 --quiet`,
        { stdio: 'pipe', timeout: 30000 }
      );

      // Step 2: Polygonalize the mask
      const vectorPath = join(tmpDir, 'perimeter.geojson');
      execSync(
        `gdal_polygonize.py "${maskPath}" -f GeoJSON "${vectorPath}" perimeter DN`,
        { stdio: 'pipe', timeout: 30000 }
      );

      // Step 2b: Skip if polygonize produced no features (empty mask)
      if (existsSync(vectorPath)) {
        const rawPoly = JSON.parse(readFileSync(vectorPath, 'utf-8')) as FeatureCollection;
        if (!rawPoly.features || rawPoly.features.length === 0) {
          console.log(`[ArrivalTimeExtractor] No burned area in ${filename}, skipping`);
          continue;
        }
      } else {
        continue;
      }

      // Step 3: Get source CRS from the arrival raster (gdal_polygonize doesn't embed it in GeoJSON)
      let sourceSrs = '';
      try {
        const srsInfo = execSync(
          `gdalsrsinfo "${inputPath}" -o proj4`,
          { stdio: 'pipe', timeout: 10000 }
        ).toString().trim();
        if (srsInfo && srsInfo.includes('+proj')) {
          sourceSrs = `-s_srs "${srsInfo}"`;
        }
      } catch {
        console.warn(`[ArrivalTimeExtractor] Could not read CRS from ${filename}, reprojection may fail`);
      }

      // Step 4: Reproject to WGS84 and dissolve
      const outputPath = join(tmpDir, 'perimeter_4326.geojson');
      execSync(
        `ogr2ogr -f GeoJSON "${outputPath}" "${vectorPath}" ${sourceSrs} -t_srs EPSG:4326 -dialect sqlite -sql "SELECT ST_Union(geometry) as geometry FROM perimeter WHERE DN=1"`,
        { stdio: 'pipe', timeout: 30000 }
      );

      // Step 5: Read the GeoJSON
      if (existsSync(outputPath)) {
        const geojsonStr = readFileSync(outputPath, 'utf-8');
        const fc = JSON.parse(geojsonStr) as FeatureCollection<Polygon | MultiPolygon>;

        if (fc.features && fc.features.length > 0) {
          perimeters.push({
            julianDay: info.julianDay,
            date: julianDayToDate(info.julianDay, year),
            geojson: fc.features[0],
          });
          successCount++;
          console.log(`[ArrivalTimeExtractor] Extracted perimeter for day ${info.julianDay}`);
        }
      }
    } catch (err) {
      console.warn(`[ArrivalTimeExtractor] Failed to process ${filename}:`, err);
    } finally {
      // Cleanup temp dir
      try {
        execSync(`rm -rf "${tmpDir}"`, { stdio: 'pipe' });
      } catch { /* best effort */ }
    }
  }

  return Result.ok({
    perimeters,
    totalGrids: arrivalFiles.length,
    successCount,
  });
}
