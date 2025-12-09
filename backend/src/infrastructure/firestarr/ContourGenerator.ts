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
 * Number of quantile breaks to generate for dynamic mode
 */
const NUM_QUANTILE_BREAKS = 8;

/**
 * Color gradient from light (outer footprint) to dark (high probability core)
 * Colors assigned by index position in the sorted thresholds array
 * Used for DYNAMIC mode
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
 * Static breaks from FireSTARR QML symbology
 * Fixed 10% probability intervals for consistent cross-model comparison
 * Source: https://github.com/CWFMF/FireSTARR/blob/main/gis/symbology/probability_processing_7pct.qml
 */
const STATIC_BREAKS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

/**
 * Static colors from FireSTARR QML symbology
 * Blue (low risk) -> Yellow -> Orange -> Red (high risk)
 */
const STATIC_COLORS = [
  '#00B1F2', // 0-10% - Cool blue (lowest risk)
  '#FAF68E', // 10-20% - Light yellow
  '#FCDF4B', // 20-30% - Yellow
  '#FAC044', // 30-40% - Yellow-orange
  '#F5A23D', // 40-50% - Orange
  '#F28938', // 50-60% - Dark orange
  '#F06C33', // 60-70% - Red-orange
  '#EE4F2C', // 70-80% - Red
  '#EB3326', // 80-90% - Dark red
  '#E6151F', // 90-100% - Darkest red (highest risk)
];

/**
 * Breaks mode type
 */
export type BreaksMode = 'static' | 'dynamic';

/**
 * Result from quantile break calculation
 */
interface QuantileBreaksResult {
  /** Threshold values in original data scale */
  breaks: number[];
  /** Factor to divide thresholds by to get 0-1 probability (for labels) */
  normalizationFactor: number;
}

/**
 * Calculate quantile breaks from raster data.
 * Returns thresholds that divide the data into equal-count bins,
 * along with a normalization factor for label display.
 */
function calculateQuantileBreaks(data: Float32Array, numBreaks: number = NUM_QUANTILE_BREAKS): QuantileBreaksResult {
  // Filter to non-zero values only (0 is nodata)
  const validValues: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (data[i] > 0) {
      validValues.push(data[i]);
    }
  }

  if (validValues.length === 0) {
    return { breaks: [], normalizationFactor: 1.0 };
  }

  // Sort values (needed for quantile calculation)
  validValues.sort((a, b) => a - b);

  // Check the max value - probability should be 0-1, but data might be in different formats
  const maxVal = validValues[validValues.length - 1];
  const minVal = validValues[0];

  console.log(`[ContourGenerator] Raw value range: ${minVal.toFixed(4)} - ${maxVal.toFixed(4)}`);

  // Normalization factor to convert to 0-1 range for labels
  // If max <= 1, assume already normalized. Otherwise normalize by max.
  let normalizationFactor = 1.0;
  if (maxVal > 1.0) {
    normalizationFactor = maxVal;
    console.log(`[ContourGenerator] Will normalize by max value ${maxVal.toFixed(4)} for labels`);
  }

  const breaks: number[] = [];

  // Calculate quantile positions
  for (let i = 0; i < numBreaks; i++) {
    const position = (i / numBreaks) * (validValues.length - 1);
    const index = Math.floor(position);
    breaks.push(validValues[index]);
  }

  // Always include the minimum value to capture full footprint
  if (!breaks.includes(minVal)) {
    breaks.unshift(minVal);
  }

  // Remove duplicates and sort ascending
  const uniqueBreaks = [...new Set(breaks)].sort((a, b) => a - b);

  console.log(`[ContourGenerator] Calculated ${uniqueBreaks.length} quantile breaks from ${validValues.length} valid pixels`);
  console.log(`[ContourGenerator] Breaks (raw): ${uniqueBreaks.map(b => b.toFixed(4)).join(', ')}`);
  console.log(`[ContourGenerator] Breaks (normalized %): ${uniqueBreaks.map(b => ((b / normalizationFactor) * 100).toFixed(1) + '%').join(', ')}`);

  return { breaks: uniqueBreaks, normalizationFactor };
}

/**
 * Get color for a threshold by its index position (dynamic mode)
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
 * Get color for a static threshold value
 */
function getStaticColor(threshold: number): string {
  // Find the index in STATIC_BREAKS that matches this threshold
  const index = STATIC_BREAKS.findIndex(b => Math.abs(b - threshold) < 0.001);
  if (index >= 0 && index < STATIC_COLORS.length) {
    return STATIC_COLORS[index];
  }
  // Fallback: interpolate based on threshold value
  const colorIndex = Math.min(Math.floor(threshold * 10), STATIC_COLORS.length - 1);
  return STATIC_COLORS[colorIndex];
}

/**
 * Cache for generated contours
 */
const contourCache: Map<string, FeatureCollection> = new Map();

/**
 * Generates GeoJSON polygons from a GeoTIFF probability raster.
 * Supports two modes:
 * - 'dynamic': Calculates quantile breaks from actual data (default)
 * - 'static': Uses fixed FireSTARR symbology breaks (10% intervals)
 *
 * @param filePath Path to the GeoTIFF file
 * @param mode Breaks mode: 'static' or 'dynamic' (default: 'dynamic')
 * @param numBreaks Optional number of quantile breaks for dynamic mode (default: 8)
 * @returns GeoJSON FeatureCollection of polygons
 */
export async function generateContours(
  filePath: string,
  mode: BreaksMode = 'dynamic',
  numBreaks: number = NUM_QUANTILE_BREAKS
): Promise<FeatureCollection> {
  // Check cache (use filePath + mode + numBreaks as key)
  const cacheKey = `${filePath}:${mode}:${numBreaks}`;
  const cached = contourCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  console.log(`[ContourGenerator] Generating contours for ${filePath} (mode: ${mode})`);

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

  // Get thresholds based on mode
  let thresholds: number[];
  let normalizationFactor = 1.0; // For converting raw values to 0-1 probability

  if (mode === 'static') {
    // Use fixed FireSTARR symbology breaks (already in 0-1 range)
    thresholds = [...STATIC_BREAKS];
    console.log(`[ContourGenerator] Using static breaks: ${thresholds.join(', ')}`);
  } else {
    // Calculate quantile breaks from the actual data
    const result = calculateQuantileBreaks(data, numBreaks);
    thresholds = result.breaks;
    normalizationFactor = result.normalizationFactor;
  }

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

      // Get color based on mode
      const color = mode === 'static'
        ? getStaticColor(threshold)
        : getColorByIndex(i, sortedThresholds.length);

      // Calculate normalized probability (0-1) and label
      const normalizedProbability = threshold / normalizationFactor;
      const labelPercent = Math.min(normalizedProbability * 100, 100).toFixed(0);

      for (const polygon of polygons) {
        features.push({
          type: 'Feature',
          properties: {
            probability: normalizedProbability, // Store normalized 0-1 value
            rawValue: threshold, // Store original value for reference
            color,
            label: `${labelPercent}%`,
            mode, // Include mode in properties for frontend reference
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

/**
 * Clear the tile cache
 */
export function clearTileCache(): void {
  tileCache.clear();
}

/**
 * Get bounds of a GeoTIFF raster in WGS84 (EPSG:4326)
 * @param filePath Path to the GeoTIFF file
 * @returns [west, south, east, north] in WGS84
 */
export async function getRasterBounds(filePath: string): Promise<[number, number, number, number]> {
  // Use gdalinfo to get bounds in WGS84
  try {
    const cmd = `gdalinfo -json "${filePath}"`;
    const output = execSync(cmd, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    const info = JSON.parse(output);

    // Try to get wgs84Extent first (most accurate for reprojected bounds)
    if (info.wgs84Extent && info.wgs84Extent.coordinates && info.wgs84Extent.coordinates[0]) {
      const coords = info.wgs84Extent.coordinates[0];
      let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
      for (const [lng, lat] of coords) {
        if (lng < west) west = lng;
        if (lng > east) east = lng;
        if (lat < south) south = lat;
        if (lat > north) north = lat;
      }
      return [west, south, east, north];
    }

    // Fall back to cornerCoordinates
    if (info.cornerCoordinates) {
      const cc = info.cornerCoordinates;
      // These may be in the native CRS, so we may need to reproject
      // For now, assume they're reasonable
      const west = Math.min(cc.upperLeft[0], cc.lowerLeft[0]);
      const east = Math.max(cc.upperRight[0], cc.lowerRight[0]);
      const south = Math.min(cc.lowerLeft[1], cc.lowerRight[1]);
      const north = Math.max(cc.upperLeft[1], cc.upperRight[1]);
      return [west, south, east, north];
    }

    throw new Error('Could not determine bounds from gdalinfo');
  } catch (err) {
    console.error('[ContourGenerator] Error getting raster bounds:', err);
    throw err;
  }
}

/**
 * Cache for raster metadata (value range)
 */
const rasterMetadataCache: Map<string, { min: number; max: number }> = new Map();

/**
 * Cache for generated tiles (filePath:z:x:y -> PNG buffer)
 */
const tileCache: Map<string, Buffer | null> = new Map();

/**
 * Get min/max values from a raster (cached)
 */
async function getRasterValueRange(filePath: string): Promise<{ min: number; max: number }> {
  const cached = rasterMetadataCache.get(filePath);
  if (cached) return cached;

  try {
    // Use gdalinfo to get statistics
    const cmd = `gdalinfo -json -stats "${filePath}"`;
    const output = execSync(cmd, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    const info = JSON.parse(output);

    if (info.bands && info.bands[0]) {
      const band = info.bands[0];
      // Try computedStatistics first, then metadata
      const min = band.computedMin ?? band.minimum ?? 0;
      const max = band.computedMax ?? band.maximum ?? 1;
      const result = { min, max };
      rasterMetadataCache.set(filePath, result);
      console.log(`[ContourGenerator] Raster value range for ${filePath}: ${min} - ${max}`);
      return result;
    }
  } catch (err) {
    console.warn('[ContourGenerator] Could not get raster stats:', err);
  }

  // Default to 0-1 range (probability data)
  console.log(`[ContourGenerator] Using default 0-1 range for ${filePath}`);
  return { min: 0, max: 1 };
}

/**
 * Generate a PNG tile from a GeoTIFF for slippy map display
 * Uses GDAL to extract and colorize the tile
 *
 * @param filePath Path to the GeoTIFF file
 * @param z Zoom level
 * @param x Tile X coordinate
 * @param y Tile Y coordinate
 * @returns PNG buffer or null if tile is outside bounds
 */
export async function generateRasterTile(
  filePath: string,
  z: number,
  x: number,
  y: number
): Promise<Buffer | null> {
  // Check tile cache first
  const cacheKey = `${filePath}:${z}:${x}:${y}`;
  const cached = tileCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const tempId = randomUUID().slice(0, 8);
  const tempDir = tmpdir();
  const tilePath = join(tempDir, `tile_${tempId}.png`);
  const colorTablePath = join(tempDir, `colors_${tempId}.txt`);
  const vrtPath = join(tempDir, `tile_${tempId}.vrt`);

  try {
    const tileSize = 256;

    // Standard Web Mercator tile to longitude
    const tileToLon = (tileX: number, zoom: number): number => {
      return (tileX / Math.pow(2, zoom)) * 360 - 180;
    };

    // Standard Web Mercator tile to latitude (correct formula)
    const tileToLat = (tileY: number, zoom: number): number => {
      const n = Math.PI - (2 * Math.PI * tileY) / Math.pow(2, zoom);
      return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    };

    // Calculate tile bounds in WGS84
    const west = tileToLon(x, z);
    const east = tileToLon(x + 1, z);
    const north = tileToLat(y, z);
    const south = tileToLat(y + 1, z);

    // Add small buffer (~1 pixel) to ensure tiles overlap slightly and eliminate seams
    const lonBuffer = (east - west) / tileSize;
    const latBuffer = (north - south) / tileSize;
    const westBuf = west - lonBuffer;
    const eastBuf = east + lonBuffer;
    const northBuf = north + latBuffer;
    const southBuf = south - latBuffer;

    // Check if tile intersects raster bounds (use unbuffered for check)
    const rasterBounds = await getRasterBounds(filePath);
    if (
      east < rasterBounds[0] ||
      west > rasterBounds[2] ||
      north < rasterBounds[1] ||
      south > rasterBounds[3]
    ) {
      // Tile is outside raster bounds - cache the null result
      tileCache.set(cacheKey, null);
      return null;
    }

    // Get the actual value range from the raster
    const { max: maxVal } = await getRasterValueRange(filePath);

    // Create color table matching FireSTARR QML symbology
    // FireSTARR uses DISCRETE color classes (not smooth interpolation)
    // Each 10% probability band has a distinct color
    // Source: https://github.com/CWFMF/FireSTARR/blob/main/gis/symbology/probability_processing_7pct.qml
    //
    // Using consistent alpha (200) for all bands so colors display evenly
    // MapBox layer opacity control handles transparency instead
    // Breakpoints at band boundaries (0.1, 0.2, etc.) with exact matching
    const colorTable = `
0 0 0 0 0
${(0.01 * maxVal).toFixed(6)} 0 177 242 200
${(0.10 * maxVal).toFixed(6)} 0 177 242 200
${(0.11 * maxVal).toFixed(6)} 250 246 142 200
${(0.20 * maxVal).toFixed(6)} 250 246 142 200
${(0.21 * maxVal).toFixed(6)} 252 223 75 200
${(0.30 * maxVal).toFixed(6)} 252 223 75 200
${(0.31 * maxVal).toFixed(6)} 250 192 68 200
${(0.40 * maxVal).toFixed(6)} 250 192 68 200
${(0.41 * maxVal).toFixed(6)} 245 162 61 200
${(0.50 * maxVal).toFixed(6)} 245 162 61 200
${(0.51 * maxVal).toFixed(6)} 242 137 56 200
${(0.60 * maxVal).toFixed(6)} 242 137 56 200
${(0.61 * maxVal).toFixed(6)} 240 108 51 200
${(0.70 * maxVal).toFixed(6)} 240 108 51 200
${(0.71 * maxVal).toFixed(6)} 238 79 44 200
${(0.80 * maxVal).toFixed(6)} 238 79 44 200
${(0.81 * maxVal).toFixed(6)} 235 51 38 200
${(0.90 * maxVal).toFixed(6)} 235 51 38 200
${(0.91 * maxVal).toFixed(6)} 230 21 31 200
${maxVal.toFixed(6)} 230 21 31 200
nv 0 0 0 0
`.trim();

    writeFileSync(colorTablePath, colorTable);

    // Use gdalwarp to extract tile area and reproject
    // Using bilinear interpolation for smoother results
    // -srcnodata 0 -dstnodata 0 ensures zeros are treated as nodata and stay transparent
    // Use buffered bounds to eliminate seams at tile edges
    const warpCmd = `gdalwarp -t_srs EPSG:4326 -te ${westBuf} ${southBuf} ${eastBuf} ${northBuf} -ts ${tileSize} ${tileSize} -r bilinear -srcnodata 0 -dstnodata 0 -of VRT "${filePath}" "${vrtPath}" 2>/dev/null`;

    try {
      execSync(warpCmd, { encoding: 'utf8', stdio: 'pipe' });
    } catch {
      // Warp failed - tile may be entirely outside raster
      return null;
    }

    if (!existsSync(vrtPath)) {
      return null;
    }

    // Apply color relief - using exact band boundaries so interpolation creates flat bands
    // Each 10% band has same color at start and end, so gdaldem produces discrete classes
    const colorCmd = `gdaldem color-relief "${vrtPath}" "${colorTablePath}" "${tilePath}" -of PNG -alpha 2>/dev/null`;

    try {
      execSync(colorCmd, { encoding: 'utf8', stdio: 'pipe' });
    } catch {
      // Colorize failed
      return null;
    }

    if (!existsSync(tilePath)) {
      tileCache.set(cacheKey, null);
      return null;
    }

    // Read the PNG and cache it
    const buffer = readFileSync(tilePath);
    tileCache.set(cacheKey, buffer);
    return buffer;
  } catch (err) {
    console.error(`[ContourGenerator] Error generating tile z=${z} x=${x} y=${y}:`, err);
    tileCache.set(cacheKey, null);
    return null;
  } finally {
    // Cleanup temp files
    for (const path of [tilePath, colorTablePath, vrtPath]) {
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
