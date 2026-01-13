/**
 * Perimeter Generator for FireSTARR
 *
 * Converts probability rasters to vector polygons using GDAL tools.
 * Supports multiple confidence intervals and optional smoothing.
 */

import { execSync } from 'child_process';
import { existsSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import { Result } from '../../application/common/index.js';
import { ValidationError, NotFoundError } from '../../domain/errors/index.js';

/**
 * Options for perimeter generation
 */
export interface PerimeterGeneratorOptions {
  /** Confidence interval (10-90), represents the threshold (e.g., 50 = pixels >= 0.5) */
  confidenceInterval: number;
  /** Whether to simplify the polygon */
  smoothPerimeter: boolean;
  /** Simplification tolerance in degrees (default: 0.0001 ~= 10m) */
  simplifyTolerance?: number;
}

/**
 * Generated perimeter result
 */
export interface GeneratedPerimeter {
  /** Day number (extracted from filename) */
  day: number;
  /** Date string in YYYY-MM-DD format (if available in filename) */
  date: string | null;
  /** GeoJSON polygon or multipolygon feature */
  geojson: Feature<Polygon | MultiPolygon>;
  /** Confidence interval used for thresholding */
  confidenceInterval: number;
}

/**
 * Result of perimeter generation for all probability rasters
 */
export interface PerimeterGenerationResult {
  /** Array of generated perimeters, one per day */
  perimeters: GeneratedPerimeter[];
  /** Total number of rasters processed */
  totalRasters: number;
  /** Number of successful perimeter generations */
  successCount: number;
}

/**
 * Extracted info from probability raster filename
 */
interface FilenameInfo {
  day: number;
  date: string | null;
}

/**
 * Extracts day number and date from probability raster filename
 * Expected format: probability_NNN_YYYY-MM-DD.tif or probability_NNN.tif
 */
function extractInfoFromFilename(filename: string): FilenameInfo | null {
  const match = filename.match(/probability_(\d+)(?:_(\d{4}-\d{2}-\d{2}))?\.tif$/);
  if (!match) return null;
  return {
    day: parseInt(match[1], 10),
    date: match[2] || null,
  };
}

/**
 * Checks if GDAL tools are available
 */
export function isGDALAvailable(): boolean {
  try {
    execSync('which gdal_calc.py', { stdio: 'pipe' });
    execSync('which gdal_polygonize.py', { stdio: 'pipe' });
    execSync('which ogr2ogr', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Generates vector perimeters from probability rasters
 *
 * For each probability raster file:
 * 1. Threshold the raster: keep pixels where value >= (confidenceInterval/100)
 * 2. Polygonize using gdal_polygonize.py
 * 3. If smoothPerimeter is true: simplify using ogr2ogr
 *
 * @param workingDir - Directory containing probability_*.tif files
 * @param options - Generation options (confidenceInterval, smoothPerimeter)
 * @returns Result with array of generated perimeters or error
 */
export async function generatePerimeters(
  workingDir: string,
  options: PerimeterGeneratorOptions
): Promise<Result<PerimeterGenerationResult, ValidationError | NotFoundError>> {
  const { confidenceInterval, smoothPerimeter, simplifyTolerance = 0.0001 } = options;

  // Validate confidence interval
  if (confidenceInterval < 10 || confidenceInterval > 90) {
    return Result.fail(
      new ValidationError('Confidence interval must be between 10 and 90', [
        { field: 'confidenceInterval', message: `Got ${confidenceInterval}` },
      ])
    );
  }

  // Check working directory exists
  if (!existsSync(workingDir)) {
    return Result.fail(new NotFoundError('Working directory', workingDir));
  }

  // Check GDAL availability
  if (!isGDALAvailable()) {
    return Result.fail(
      new ValidationError('GDAL tools not available', [
        { field: 'gdal', message: 'Install gdal-async and ensure gdal_calc.py, gdal_polygonize.py, and ogr2ogr are in PATH' },
      ])
    );
  }

  try {
    // Find all probability raster files
    const { readdirSync } = await import('fs');
    const files = readdirSync(workingDir);
    const probabilityFiles = files.filter(f => f.match(/^probability_\d+(?:_[\d-]+)?\.tif$/));

    if (probabilityFiles.length === 0) {
      return Result.fail(
        new NotFoundError('Probability rasters', workingDir, 'No probability_*.tif files found')
      );
    }

    console.log(`[PerimeterGenerator] Found ${probabilityFiles.length} probability rasters in ${workingDir}`);

    // Calculate threshold value (confidence interval as decimal)
    const threshold = confidenceInterval / 100;

    const perimeters: GeneratedPerimeter[] = [];
    let successCount = 0;

    // Process each raster
    for (const file of probabilityFiles) {
      const info = extractInfoFromFilename(file);
      if (!info) {
        console.warn(`[PerimeterGenerator] Skipping ${file}: could not extract day number`);
        continue;
      }

      const inputPath = join(workingDir, file);

      try {
        const perimeter = await generateSinglePerimeter(
          inputPath,
          info.day,
          threshold,
          smoothPerimeter,
          simplifyTolerance
        );

        if (perimeter) {
          perimeters.push({
            day: info.day,
            date: info.date,
            geojson: perimeter,
            confidenceInterval,
          });
          successCount++;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[PerimeterGenerator] Failed to generate perimeter for ${file}: ${message}`);
        // Continue processing other files
      }
    }

    // Sort by day
    perimeters.sort((a, b) => a.day - b.day);

    console.log(`[PerimeterGenerator] Successfully generated ${successCount}/${probabilityFiles.length} perimeters`);

    return Result.ok({
      perimeters,
      totalRasters: probabilityFiles.length,
      successCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Result.fail(new ValidationError(`Perimeter generation failed: ${message}`));
  }
}

/**
 * Generates a single perimeter from a probability raster
 */
async function generateSinglePerimeter(
  inputPath: string,
  day: number,
  threshold: number,
  smoothPerimeter: boolean,
  simplifyTolerance: number
): Promise<Feature<Polygon | MultiPolygon> | null> {
  // Create temporary directory for intermediate files
  const tempDir = mkdtempSync(join(tmpdir(), 'perimeter-'));

  try {
    // Step 1: Threshold the raster
    const thresholdPath = join(tempDir, `threshold_day${day}.tif`);
    const calcCmd = `gdal_calc.py -A "${inputPath}" --outfile="${thresholdPath}" --calc="A>=${threshold}" --type=Byte --quiet --overwrite`;

    console.log(`[PerimeterGenerator] Thresholding day ${day} at ${threshold}`);
    execSync(calcCmd, { encoding: 'utf8', stdio: 'pipe' });

    if (!existsSync(thresholdPath)) {
      console.warn(`[PerimeterGenerator] Threshold step produced no output for day ${day}`);
      return null;
    }

    // Step 2: Polygonize to GeoJSON (in source CRS - likely UTM)
    const polyPath = join(tempDir, `poly_day${day}.geojson`);
    const polygonizeCmd = `gdal_polygonize.py "${thresholdPath}" -f GeoJSON "${polyPath}" -q`;

    console.log(`[PerimeterGenerator] Polygonizing day ${day}`);
    execSync(polygonizeCmd, { encoding: 'utf8', stdio: 'pipe' });

    if (!existsSync(polyPath)) {
      console.warn(`[PerimeterGenerator] Polygonize step produced no output for day ${day}`);
      return null;
    }

    // Step 3: Detect source CRS from the input raster
    let sourceCRS: string | null = null;
    try {
      const gdalInfoOutput = execSync(`gdalinfo "${inputPath}"`, { encoding: 'utf8', stdio: 'pipe' });

      // Try to extract EPSG code if available
      const epsgMatch = gdalInfoOutput.match(/AUTHORITY\["EPSG","(\d+)"\]/);
      if (epsgMatch) {
        sourceCRS = `EPSG:${epsgMatch[1]}`;
        console.log(`[PerimeterGenerator] Detected source CRS: ${sourceCRS}`);
      } else {
        // Build PROJ4 string from projection parameters instead of guessing EPSG
        // This handles non-standard projections like FireSTARR's custom TM with CM at zone boundaries
        const centralMeridianMatch = gdalInfoOutput.match(/Longitude of natural origin"?,?\s*(-?\d+(?:\.\d+)?)/);
        const scaleFactorMatch = gdalInfoOutput.match(/Scale factor at natural origin"?,?\s*([\d.]+)/);
        const falseEastingMatch = gdalInfoOutput.match(/False easting"?,?\s*(\d+)/);
        const falseNorthingMatch = gdalInfoOutput.match(/False northing"?,?\s*(\d+)/);

        if (centralMeridianMatch) {
          const centralMeridian = parseFloat(centralMeridianMatch[1]);
          const scaleFactor = scaleFactorMatch ? parseFloat(scaleFactorMatch[1]) : 0.9996;
          const falseEasting = falseEastingMatch ? parseInt(falseEastingMatch[1]) : 500000;
          const falseNorthing = falseNorthingMatch ? parseInt(falseNorthingMatch[1]) : 0;

          // Build PROJ4 string with actual parameters from the raster
          sourceCRS = `+proj=tmerc +lat_0=0 +lon_0=${centralMeridian} +k=${scaleFactor} +x_0=${falseEasting} +y_0=${falseNorthing} +datum=NAD83 +units=m +no_defs`;
          console.log(`[PerimeterGenerator] Built PROJ4 from raster params: lon_0=${centralMeridian}, k=${scaleFactor}`);
        }
      }
    } catch (error) {
      console.warn(`[PerimeterGenerator] Failed to detect source CRS: ${error}`);
    }

    // Step 4: Reproject to WGS84 (EPSG:4326) for MapBox compatibility
    const wgs84Path = join(tempDir, `wgs84_day${day}.geojson`);

    // Build reprojection command with explicit source CRS if detected
    // PROJ4 strings need quotes since they contain spaces
    const reprojectCmd = sourceCRS
      ? `ogr2ogr -f GeoJSON -s_srs "${sourceCRS}" -t_srs EPSG:4326 "${wgs84Path}" "${polyPath}"`
      : `ogr2ogr -f GeoJSON -t_srs EPSG:4326 "${wgs84Path}" "${polyPath}"`;

    console.log(`[PerimeterGenerator] Reprojecting day ${day} to WGS84${sourceCRS ? ` from ${sourceCRS.substring(0, 50)}...` : ''}`);
    execSync(reprojectCmd, { encoding: 'utf8', stdio: 'pipe' });

    if (!existsSync(wgs84Path)) {
      console.warn(`[PerimeterGenerator] Reprojection failed for day ${day}, using original projection`);
      // Fall back to original (will likely fail on map but at least we have something)
    }

    // Step 5: Optionally simplify
    let finalPath = existsSync(wgs84Path) ? wgs84Path : polyPath;
    if (smoothPerimeter) {
      const smoothPath = join(tempDir, `smooth_day${day}.geojson`);
      const simplifyCmd = `ogr2ogr -f GeoJSON "${smoothPath}" "${finalPath}" -simplify ${simplifyTolerance}`;

      console.log(`[PerimeterGenerator] Simplifying day ${day} (tolerance=${simplifyTolerance})`);
      execSync(simplifyCmd, { encoding: 'utf8', stdio: 'pipe' });

      if (existsSync(smoothPath)) {
        finalPath = smoothPath;
      } else {
        console.warn(`[PerimeterGenerator] Simplify step failed for day ${day}, using non-simplified polygon`);
      }
    }

    // Read the resulting GeoJSON
    const { readFileSync } = await import('fs');
    const geojsonContent = readFileSync(finalPath, 'utf-8');
    const geojson = JSON.parse(geojsonContent);

    // Extract the first feature (gdal_polygonize creates a FeatureCollection)
    if (geojson.type === 'FeatureCollection' && geojson.features && geojson.features.length > 0) {
      // Filter out features with DN=0 (background pixels)
      const validFeatures = geojson.features.filter((f: Feature) => {
        const dn = f.properties?.DN;
        return dn !== 0 && dn !== null && dn !== undefined;
      });

      if (validFeatures.length === 0) {
        console.warn(`[PerimeterGenerator] No valid features for day ${day} after filtering DN=0`);
        return null;
      }

      // Combine all features into a single MultiPolygon
      if (validFeatures.length === 1) {
        return validFeatures[0] as Feature<Polygon | MultiPolygon>;
      } else {
        // Collect all polygon coordinates into a MultiPolygon
        const allCoordinates: number[][][][] = [];
        for (const feature of validFeatures) {
          const geom = feature.geometry;
          if (geom.type === 'Polygon') {
            allCoordinates.push(geom.coordinates);
          } else if (geom.type === 'MultiPolygon') {
            allCoordinates.push(...geom.coordinates);
          }
        }

        return {
          type: 'Feature',
          properties: { DN: 1 },
          geometry: {
            type: 'MultiPolygon',
            coordinates: allCoordinates,
          },
        } as Feature<MultiPolygon>;
      }
    }

    console.warn(`[PerimeterGenerator] No features found in GeoJSON for day ${day}`);
    return null;
  } finally {
    // Clean up temporary files
    try {
      const { rmSync } = await import('fs');
      rmSync(tempDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.warn(`[PerimeterGenerator] Failed to clean up temp directory: ${cleanupError}`);
    }
  }
}

/**
 * Generates a single perimeter from a specific probability raster file
 * Useful for on-demand perimeter generation
 */
export async function generatePerimeterForFile(
  filePath: string,
  options: PerimeterGeneratorOptions
): Promise<Result<GeneratedPerimeter, ValidationError | NotFoundError>> {
  const { confidenceInterval, smoothPerimeter, simplifyTolerance = 0.0001 } = options;

  // Validate file exists
  if (!existsSync(filePath)) {
    return Result.fail(new NotFoundError('Probability raster', filePath));
  }

  // Extract day and date from filename
  const filename = filePath.split('/').pop() || '';
  const info = extractInfoFromFilename(filename);
  if (!info) {
    return Result.fail(
      new ValidationError('Invalid filename format', [
        { field: 'filename', message: `Expected probability_NNN.tif or probability_NNN_YYYY-MM-DD.tif, got ${filename}` },
      ])
    );
  }

  // Validate confidence interval
  if (confidenceInterval < 10 || confidenceInterval > 90) {
    return Result.fail(
      new ValidationError('Confidence interval must be between 10 and 90', [
        { field: 'confidenceInterval', message: `Got ${confidenceInterval}` },
      ])
    );
  }

  // Check GDAL availability
  if (!isGDALAvailable()) {
    return Result.fail(
      new ValidationError('GDAL tools not available', [
        { field: 'gdal', message: 'Install GDAL tools (gdal_calc.py, gdal_polygonize.py, ogr2ogr)' },
      ])
    );
  }

  try {
    const threshold = confidenceInterval / 100;
    const perimeter = await generateSinglePerimeter(
      filePath,
      info.day,
      threshold,
      smoothPerimeter,
      simplifyTolerance
    );

    if (!perimeter) {
      return Result.fail(
        new ValidationError('Perimeter generation produced no output', [
          { field: 'perimeter', message: 'No features found after thresholding and polygonizing' },
        ])
      );
    }

    return Result.ok({
      day: info.day,
      date: info.date,
      geojson: perimeter,
      confidenceInterval,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Result.fail(new ValidationError(`Perimeter generation failed: ${message}`));
  }
}
