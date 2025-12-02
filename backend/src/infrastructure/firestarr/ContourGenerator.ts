/**
 * Contour Generator
 *
 * Converts GeoTIFF probability rasters to GeoJSON polygons using GDAL CLI tools.
 * Uses gdal_polygonize for raster-to-vector conversion and ogr2ogr for simplification.
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import type { FeatureCollection, Feature, Polygon, MultiPolygon } from 'geojson';

/**
 * Number of quantile breaks to generate
 */
const NUM_QUANTILE_BREAKS = 8;

/**
 * Color gradient from light (outer footprint) to dark (high probability core)
 * Colors assigned by index position in the sorted thresholds array
 */
const QUANTILE_COLORS = [
  '#ffffcc', // Lightest - outer footprint (lowest quantile)
  '#ffeda0',
  '#fed976',
  '#feb24c',
  '#fd8d3c',
  '#fc4e2a',
  '#e31a1c',
  '#b10026', // Darkest - core (highest quantile)
];

/**
 * Calculate quantile breaks from raster data.
 * Returns thresholds that divide the data into equal-count bins.
 */
function calculateQuantileBreaks(data: Float32Array, numBreaks: number = NUM_QUANTILE_BREAKS): number[] {
  // Filter to non-zero values only (0 is nodata)
  const validValues: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (data[i] > 0) {
      validValues.push(data[i]);
    }
  }

  if (validValues.length === 0) return [];

  // Sort values
  validValues.sort((a, b) => a - b);

  const breaks: number[] = [];

  // Calculate quantile positions
  for (let i = 0; i < numBreaks; i++) {
    const position = (i / numBreaks) * (validValues.length - 1);
    const index = Math.floor(position);
    breaks.push(validValues[index]);
  }

  // Always include the minimum value to capture full footprint
  const minVal = validValues[0];
  if (!breaks.includes(minVal)) {
    breaks.unshift(minVal);
  }

  // Remove duplicates and sort ascending
  const uniqueBreaks = [...new Set(breaks)].sort((a, b) => a - b);

  console.log(`[ContourGenerator] Calculated ${uniqueBreaks.length} quantile breaks from ${validValues.length} valid pixels`);
  console.log(`[ContourGenerator] Breaks: ${uniqueBreaks.map(b => b.toFixed(4)).join(', ')}`);

  return uniqueBreaks;
}

/**
 * Get color for a threshold by its index position
 */
function getColorByIndex(index: number, totalBreaks: number): string {
  // Map index to color array position
  const colorIndex = Math.min(
    Math.floor((index / Math.max(totalBreaks - 1, 1)) * (QUANTILE_COLORS.length - 1)),
    QUANTILE_COLORS.length - 1
  );
  return QUANTILE_COLORS[colorIndex];
}

/**
 * Cache for generated contours
 */
const contourCache: Map<string, FeatureCollection> = new Map();

/**
 * Generates GeoJSON polygons from a GeoTIFF probability raster.
 * Automatically calculates quantile breaks from the data to ensure full footprint coverage.
 *
 * @param filePath Path to the GeoTIFF file
 * @param numBreaks Optional number of quantile breaks (default: 8)
 * @returns GeoJSON FeatureCollection of polygons
 */
export async function generateContours(
  filePath: string,
  numBreaks: number = NUM_QUANTILE_BREAKS
): Promise<FeatureCollection> {
  // Check cache (use filePath + numBreaks as key)
  const cacheKey = `${filePath}:${numBreaks}`;
  const cached = contourCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Load GDAL for reading raster info
  let gdal: typeof import('gdal-async').default;
  try {
    const gdalModule = await import('gdal-async');
    gdal = gdalModule.default;
  } catch (err) {
    throw new Error(`GDAL not available - required for contour generation: ${err}`);
  }

  // Get raster info (pixel size for simplification tolerance)
  const dataset = await gdal.openAsync(filePath);
  const geoTransform = dataset.geoTransform;
  const { x: width, y: height } = dataset.rasterSize;
  const band = dataset.bands.get(1);
  const srs = dataset.srs;

  if (!geoTransform || !band) {
    dataset.close();
    throw new Error(`Invalid raster - missing geotransform or band: ${filePath}`);
  }

  // Get WKT for coordinate transformation
  const sourceWkt = srs ? srs.toWKT() : '';
  if (!sourceWkt) {
    console.warn(`[ContourGenerator] No SRS found in raster: ${filePath}`);
  }

  // Pixel size in CRS units (use for simplification tolerance)
  const pixelSizeX = Math.abs(geoTransform[1]);
  const pixelSizeY = Math.abs(geoTransform[5]);
  const pixelSize = Math.max(pixelSizeX, pixelSizeY);

  // Read all pixels to create binary masks
  const data = band.pixels.read(0, 0, width, height) as Float32Array;
  dataset.close();

  // Calculate quantile breaks from the actual data
  const thresholds = calculateQuantileBreaks(data, numBreaks);

  if (thresholds.length === 0) {
    console.warn(`[ContourGenerator] No valid data found in raster: ${filePath}`);
    return { type: 'FeatureCollection', features: [] };
  }

  // Generate polygons for each threshold
  const features: Feature<Polygon | MultiPolygon>[] = [];

  // Sort thresholds ascending so higher probabilities are added last and render on top
  const sortedThresholds = [...thresholds].sort((a, b) => a - b);

  for (let i = 0; i < sortedThresholds.length; i++) {
    const threshold = sortedThresholds[i];
    // Color index matches position (low=light, high=dark)
    const colorIndex = i;

    try {
      const polygons = await generatePolygonsForThreshold(
        filePath,
        data,
        width,
        height,
        geoTransform,
        threshold,
        pixelSize,
        gdal,
        sourceWkt
      );

      for (const polygon of polygons) {
        features.push({
          type: 'Feature',
          properties: {
            probability: threshold,
            color: getColorByIndex(colorIndex, sortedThresholds.length),
            label: `${(threshold * 100).toFixed(1)}%`,
          },
          geometry: polygon,
        });
      }
    } catch (err) {
      console.warn(`[ContourGenerator] Failed to generate polygons for threshold ${threshold}:`, err);
    }
  }

  const result: FeatureCollection = {
    type: 'FeatureCollection',
    features,
  };

  // Cache result
  contourCache.set(cacheKey, result);

  console.log(`[ContourGenerator] Generated ${features.length} polygon features for ${filePath}`);

  return result;
}

/**
 * Generate polygons for a single probability threshold.
 */
async function generatePolygonsForThreshold(
  originalPath: string,
  data: Float32Array,
  width: number,
  height: number,
  geoTransform: number[],
  threshold: number,
  pixelSize: number,
  gdal: typeof import('gdal-async').default,
  sourceWkt: string
): Promise<(Polygon | MultiPolygon)[]> {
  const tempId = randomUUID().slice(0, 8);
  const tempDir = tmpdir();
  const maskPath = join(tempDir, `mask_${tempId}.tif`);
  const polyPath = join(tempDir, `poly_${tempId}.gpkg`);  // Use GeoPackage to preserve CRS
  const smoothPath = join(tempDir, `smooth_${tempId}.geojson`);
  const wktPath = join(tempDir, `srs_${tempId}.wkt`);

  try {
    // 1. Create binary mask raster (with SRS from original)
    await createBinaryMask(gdal, data, width, height, geoTransform, threshold, maskPath, originalPath);

    // 2. Run gdal_polygonize to GeoPackage (preserves CRS)
    const polygonizeCmd = `gdal_polygonize.py "${maskPath}" -f GPKG "${polyPath}" -q`;
    execSync(polygonizeCmd, { encoding: 'utf8', stdio: 'pipe' });

    if (!existsSync(polyPath)) {
      console.warn(`[ContourGenerator] Polygonize produced no output for threshold ${threshold}`);
      return [];
    }

    // 3. Simplify and reproject to WGS84
    // Write WKT to temp file for ogr2ogr -s_srs
    writeFileSync(wktPath, sourceWkt);
    const simplifyCmd = `ogr2ogr -f GeoJSON -simplify ${pixelSize} -s_srs "${wktPath}" -t_srs EPSG:4326 "${smoothPath}" "${polyPath}"`;
    execSync(simplifyCmd, { encoding: 'utf8', stdio: 'pipe' });

    if (!existsSync(smoothPath)) {
      console.warn(`[ContourGenerator] Simplification produced no output for threshold ${threshold}`);
      return [];
    }

    // 4. Read the result and filter
    const geojsonStr = readFileSync(smoothPath, 'utf8');
    const geojson = JSON.parse(geojsonStr) as FeatureCollection;

    // Filter to only polygons where DN=1 (pixels above threshold)
    const polygons: (Polygon | MultiPolygon)[] = [];
    for (const feature of geojson.features) {
      if (feature.properties?.DN === 1 && feature.geometry) {
        const geomType = feature.geometry.type;
        if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
          polygons.push(feature.geometry as Polygon | MultiPolygon);
        }
      }
    }

    return polygons;
  } finally {
    // Cleanup temp files
    for (const path of [maskPath, polyPath, smoothPath, wktPath]) {
      try {
        if (existsSync(path)) {
          unlinkSync(path);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Create a binary mask raster where pixels >= threshold = 1, else 0.
 */
async function createBinaryMask(
  gdal: typeof import('gdal-async').default,
  data: Float32Array,
  width: number,
  height: number,
  geoTransform: number[],
  threshold: number,
  outputPath: string,
  originalPath: string
): Promise<void> {
  // Create binary mask data
  const maskData = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) {
    maskData[i] = data[i] >= threshold ? 1 : 0;
  }

  // Get spatial reference from original file
  const origDataset = await gdal.openAsync(originalPath);
  const srs = origDataset.srs;
  origDataset.close();

  // Create output raster
  const driver = gdal.drivers.get('GTiff');
  const outDataset = driver.create(outputPath, width, height, 1, gdal.GDT_Byte);

  outDataset.geoTransform = geoTransform;
  if (srs) {
    outDataset.srs = srs;
  }

  const outBand = outDataset.bands.get(1);
  outBand.pixels.write(0, 0, width, height, maskData);
  outBand.noDataValue = 255; // Use 255 as nodata

  outDataset.flush();
  outDataset.close();
}

/**
 * Clear the contour cache
 */
export function clearContourCache(): void {
  contourCache.clear();
}
