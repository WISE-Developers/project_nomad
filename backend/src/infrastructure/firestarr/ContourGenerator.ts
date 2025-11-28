/**
 * Contour Generator
 *
 * Converts GeoTIFF probability rasters to GeoJSON contour lines.
 * Uses GDAL for raster processing.
 */

import type { FeatureCollection, Feature, MultiPolygon, Polygon } from 'geojson';

/**
 * Default probability thresholds for contour generation
 */
const DEFAULT_THRESHOLDS = [0.1, 0.25, 0.5, 0.75, 0.9];

/**
 * Color mapping for probability values
 */
const PROBABILITY_COLORS: Record<number, string> = {
  0.1: '#00ff00',  // Green (low)
  0.25: '#80ff00', // Yellow-green
  0.5: '#ffff00',  // Yellow
  0.75: '#ff8000', // Orange
  0.9: '#ff0000',  // Red (high)
};

/**
 * Cache for generated contours
 */
const contourCache: Map<string, FeatureCollection> = new Map();

/**
 * Generates GeoJSON contours from a GeoTIFF probability raster.
 *
 * @param filePath Path to the GeoTIFF file
 * @param thresholds Optional array of probability thresholds (default: [0.1, 0.25, 0.5, 0.75, 0.9])
 * @returns GeoJSON FeatureCollection of contour polygons
 */
export async function generateContours(
  filePath: string,
  thresholds: number[] = DEFAULT_THRESHOLDS
): Promise<FeatureCollection> {
  // Check cache
  const cacheKey = `${filePath}:${thresholds.join(',')}`;
  const cached = contourCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Load GDAL - fail fast if not available
  let gdal: typeof import('gdal-async');
  try {
    gdal = await import('gdal-async');
  } catch (err) {
    throw new Error(`GDAL not available - required for contour generation: ${err}`);
  }

  // Open the raster dataset
  const dataset = await gdal.openAsync(filePath);
  const band = dataset.bands.get(1);

  if (!band) {
    dataset.close();
    throw new Error(`No band found in raster: ${filePath}`);
  }

  // Get raster info
  const { x: width, y: height } = dataset.rasterSize;
  const geoTransform = dataset.geoTransform;

  if (!geoTransform) {
    dataset.close();
    throw new Error(`No geotransform found in raster: ${filePath}`);
  }

  // Read all pixels
  const data = band.pixels.read(0, 0, width, height) as Float32Array;

  // Generate contours for each threshold
  const features: Feature<Polygon | MultiPolygon>[] = [];

  for (const threshold of thresholds.sort((a, b) => b - a)) {
    // Create binary mask for this threshold
    const contourFeatures = generateContourForThreshold(
      data,
      width,
      height,
      geoTransform,
      threshold
    );

    for (const feature of contourFeatures) {
      features.push({
        type: 'Feature',
        properties: {
          probability: threshold,
          color: PROBABILITY_COLORS[threshold] ?? '#888888',
          label: `${(threshold * 100).toFixed(0)}%`,
        },
        geometry: feature,
      });
    }
  }

  dataset.close();

  const result: FeatureCollection = {
    type: 'FeatureCollection',
    features,
  };

  // Cache result
  contourCache.set(cacheKey, result);

  return result;
}

/**
 * Generates contour polygons for a specific threshold using marching squares.
 * This is a simplified implementation - production would use GDAL's gdal_contour.
 */
function generateContourForThreshold(
  data: Float32Array,
  width: number,
  height: number,
  geoTransform: number[],
  threshold: number
): (Polygon | MultiPolygon)[] {
  const polygons: Polygon[] = [];

  // Simple raster to polygon conversion
  // Find connected regions above threshold
  const visited = new Set<number>();
  const regions: number[][] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (data[idx] >= threshold && !visited.has(idx)) {
        // Flood fill to find region
        const region = floodFill(data, width, height, x, y, threshold, visited);
        if (region.length >= 4) {
          regions.push(region);
        }
      }
    }
  }

  // Convert regions to polygons
  for (const region of regions) {
    const polygon = regionToPolygon(region, width, geoTransform);
    if (polygon) {
      polygons.push(polygon);
    }
  }

  return polygons;
}

/**
 * Flood fill to find connected region above threshold
 */
function floodFill(
  data: Float32Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
  threshold: number,
  visited: Set<number>
): number[] {
  const region: number[] = [];
  const stack: [number, number][] = [[startX, startY]];

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    const idx = y * width + x;

    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    if (visited.has(idx)) continue;
    if (data[idx] < threshold) continue;

    visited.add(idx);
    region.push(idx);

    // Add neighbors
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  return region;
}

/**
 * Convert region indices to a polygon
 */
function regionToPolygon(
  region: number[],
  width: number,
  geoTransform: number[]
): Polygon | null {
  if (region.length < 4) return null;

  // Find bounding box and create simple polygon
  // This is a simplified version - real implementation would trace the edge
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const idx of region) {
    const x = idx % width;
    const y = Math.floor(idx / width);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  // Convert to geographic coordinates
  const [originX, pixelWidth, , originY, , pixelHeight] = geoTransform;

  const toGeo = (px: number, py: number): [number, number] => [
    originX + px * pixelWidth,
    originY + py * pixelHeight,
  ];

  // Create bounding box polygon (simplified - real impl traces actual edge)
  const coords: [number, number][] = [
    toGeo(minX, minY),
    toGeo(maxX, minY),
    toGeo(maxX, maxY),
    toGeo(minX, maxY),
    toGeo(minX, minY), // Close the ring
  ];

  return {
    type: 'Polygon',
    coordinates: [coords],
  };
}

/**
 * Clear the contour cache
 */
export function clearContourCache(): void {
  contourCache.clear();
}
