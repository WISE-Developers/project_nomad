/**
 * Perimeter Rasterizer for FireSTARR
 *
 * Converts polygon geometries to GeoTIFF rasters for FireSTARR perimeter input.
 * Uses GDAL via gdal-async for coordinate transformation and raster creation.
 *
 * Requirements:
 * - Output raster must align with fuel grid (same CRS, cell size)
 * - Output extent should be local around the polygon (FireSTARR uses ~200km grids)
 * - Non-zero cell values = burned area
 * - Zero or NoData = unburned
 */

import { SpatialGeometry, GeometryType } from '../../domain/entities/index.js';
import { Result } from '../../application/common/index.js';
import { ValidationError } from '../../domain/errors/index.js';

/** FireSTARR grid size in meters (200km buffer around center) */
const FIRESTARR_GRID_HALF_SIZE = 200000; // 200km

/**
 * Options for perimeter rasterization.
 */
export interface RasterizeOptions {
  /** Polygon geometry to rasterize */
  readonly geometry: SpatialGeometry;
  /** Path to fuel grid template (for CRS/resolution reference) */
  readonly templatePath: string;
  /** Output TIF path */
  readonly outputPath: string;
  /** Value to burn into raster (default: 1) */
  readonly burnValue?: number;
}

/**
 * Rasterization result.
 */
export interface RasterizeResult {
  /** Path to output raster */
  readonly outputPath: string;
  /** Raster width in pixels */
  readonly width: number;
  /** Raster height in pixels */
  readonly height: number;
  /** Number of burned cells */
  readonly burnedCells: number;
}

/**
 * Converts polygon coordinates to WKT format.
 */
function geometryToWKT(geometry: SpatialGeometry): string {
  if (geometry.type !== GeometryType.Polygon) {
    throw new Error(`Expected Polygon geometry, got ${geometry.type}`);
  }

  const coords = geometry.coordinates as number[][][];

  // WKT format: POLYGON((x1 y1, x2 y2, ...))
  const rings = coords.map((ring) =>
    ring.map(([x, y]) => `${x} ${y}`).join(', ')
  );

  return `POLYGON((${rings.join('), (')}))`;
}

/**
 * Simple point-in-polygon test using ray casting algorithm.
 */
function pointInPolygon(x: number, y: number, polygon: number[][]): boolean {
  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];

    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Rasterizes a polygon geometry to a GeoTIFF.
 *
 * Uses gdal-async to:
 * 1. Transform polygon from WGS84 to UTM
 * 2. Create output raster with correct geotransform
 * 3. Burn polygon into raster using point-in-polygon test
 *
 * @param options - Rasterization configuration
 * @returns Result with raster info or error
 */
export async function rasterizePerimeter(
  options: RasterizeOptions
): Promise<Result<RasterizeResult, ValidationError>> {
  const { geometry, templatePath, outputPath, burnValue = 1 } = options;

  // Validate geometry type
  if (geometry.type !== GeometryType.Polygon) {
    return Result.fail(
      new ValidationError(`Perimeter must be a polygon, got ${geometry.type}`)
    );
  }

  try {
    // Dynamic import of gdal-async for coordinate transformation
    const gdalModule = await import('gdal-async');
    const gdal = gdalModule.default;

    // Open template raster to get CRS and resolution info
    const templateDs = await gdal.openAsync(templatePath);
    const geoTransform = templateDs.geoTransform;
    const projection = templateDs.srs?.toWKT() ?? '';

    if (!geoTransform) {
      templateDs.close();
      return Result.fail(new ValidationError('Template raster has no geotransform'));
    }

    const pixelWidth = geoTransform[1];
    const pixelHeight = Math.abs(geoTransform[5]); // Make positive for calculations
    templateDs.close();

    // Create geometry from WKT (coordinates are in WGS84)
    const wkt = geometryToWKT(geometry);
    const gdalGeom = gdal.Geometry.fromWKT(wkt);

    // Transform polygon from WGS84 to target CRS (UTM)
    const targetSrs = gdal.SpatialReference.fromWKT(projection);
    const wgs84 = gdal.SpatialReference.fromProj4('+proj=longlat +datum=WGS84 +no_defs');
    const transform = new gdal.CoordinateTransformation(wgs84, targetSrs);
    gdalGeom.transform(transform);

    // Get polygon centroid and envelope in UTM coordinates
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geomAny = gdalGeom as any;
    const centroid = geomAny.centroid();
    const envelope = geomAny.getEnvelope();
    const centerX = centroid.x as number;
    const centerY = centroid.y as number;

    console.log(`[PerimeterRasterizer] Polygon centroid (UTM): ${centerX.toFixed(1)}, ${centerY.toFixed(1)}`);
    console.log(`[PerimeterRasterizer] Polygon envelope: [${envelope.minX.toFixed(1)}, ${envelope.minY.toFixed(1)}, ${envelope.maxX.toFixed(1)}, ${envelope.maxY.toFixed(1)}]`);

    // Calculate local extent: 200km buffer around polygon centroid, snapped to pixel boundaries
    let minX = centerX - FIRESTARR_GRID_HALF_SIZE;
    let maxX = centerX + FIRESTARR_GRID_HALF_SIZE;
    let minY = centerY - FIRESTARR_GRID_HALF_SIZE;
    let maxY = centerY + FIRESTARR_GRID_HALF_SIZE;

    // Snap to pixel boundaries (align with fuel grid)
    minX = Math.floor(minX / pixelWidth) * pixelWidth;
    maxX = Math.ceil(maxX / pixelWidth) * pixelWidth;
    minY = Math.floor(minY / pixelHeight) * pixelHeight;
    maxY = Math.ceil(maxY / pixelHeight) * pixelHeight;

    // Calculate output dimensions
    const width = Math.round((maxX - minX) / pixelWidth);
    const height = Math.round((maxY - minY) / pixelHeight);

    console.log(`[PerimeterRasterizer] Local extent: [${minX}, ${minY}, ${maxX}, ${maxY}]`);
    console.log(`[PerimeterRasterizer] Output size: ${width}x${height} (${pixelWidth}m resolution)`);

    // Extract transformed polygon coordinates for rasterization
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transformedWkt = (gdalGeom as any).toWKT() as string;
    const coordMatch = transformedWkt.match(/POLYGON\s*\(\((.+)\)\)/i);
    if (!coordMatch) {
      return Result.fail(new ValidationError('Failed to extract transformed polygon coordinates'));
    }

    const polygonCoords = coordMatch[1].split(',').map(coordStr => {
      const [x, y] = coordStr.trim().split(/\s+/).map(Number);
      return [x, y];
    });

    console.log(`[PerimeterRasterizer] Creating output raster: ${outputPath}`);

    // Create output raster using GTiff driver
    const driver = gdal.drivers.get('GTiff');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outDs = (driver as any).create(
      outputPath,
      width,
      height,
      1,           // 1 band
      gdal.GDT_Byte, // Byte data type
      ['TILED=YES', 'COMPRESS=LZW']
    );

    // Set geotransform (upper-left corner, pixel sizes)
    outDs.geoTransform = [
      minX,           // upper-left X
      pixelWidth,     // pixel width
      0,              // rotation (0 for north-up)
      maxY,           // upper-left Y
      0,              // rotation (0 for north-up)
      -pixelHeight    // pixel height (negative for north-up)
    ];

    // Set projection
    outDs.srs = targetSrs;

    // Get band and initialize with zeros
    const band = outDs.bands.get(1);
    band.noDataValue = 0;

    // Create data buffer and burn polygon
    // We only need to check cells near the polygon, not the entire 4000x4000 grid
    const polyMinX = envelope.minX;
    const polyMaxX = envelope.maxX;
    const polyMinY = envelope.minY;
    const polyMaxY = envelope.maxY;

    // Convert polygon bounds to pixel coordinates
    const startCol = Math.max(0, Math.floor((polyMinX - minX) / pixelWidth) - 1);
    const endCol = Math.min(width - 1, Math.ceil((polyMaxX - minX) / pixelWidth) + 1);
    const startRow = Math.max(0, Math.floor((maxY - polyMaxY) / pixelHeight) - 1);
    const endRow = Math.min(height - 1, Math.ceil((maxY - polyMinY) / pixelHeight) + 1);

    console.log(`[PerimeterRasterizer] Polygon pixel extent: rows ${startRow}-${endRow}, cols ${startCol}-${endCol}`);

    // Process row by row in the polygon bounding box
    let burnedCells = 0;
    const rowWidth = endCol - startCol + 1;

    for (let row = startRow; row <= endRow; row++) {
      const rowData = new Uint8Array(rowWidth);

      for (let col = startCol; col <= endCol; col++) {
        // Convert pixel center to UTM coordinates
        const cellX = minX + (col + 0.5) * pixelWidth;
        const cellY = maxY - (row + 0.5) * pixelHeight;

        // Check if cell center is inside polygon
        if (pointInPolygon(cellX, cellY, polygonCoords)) {
          rowData[col - startCol] = burnValue;
          burnedCells++;
        }
      }

      // Write row to raster
      band.pixels.write(startCol, row, rowWidth, 1, rowData);
    }

    // Flush and close
    outDs.flush();
    outDs.close();

    console.log(`[PerimeterRasterizer] Created ${outputPath}: ${width}x${height}, ${burnedCells} burned cells`);

    return Result.ok({
      outputPath,
      width,
      height,
      burnedCells,
    });
  } catch (error) {
    // GDAL not available or rasterization failed
    const message = error instanceof Error ? error.message : String(error);

    // Check if it's a module not found error
    if (message.includes('Cannot find module') || message.includes('gdal-async')) {
      console.warn('[PerimeterRasterizer] gdal-async not installed, perimeter rasterization unavailable');
      return Result.fail(
        new ValidationError(
          'GDAL bindings not available. Install gdal-async for perimeter support.'
        )
      );
    }

    console.error('[PerimeterRasterizer] Rasterization failed:', message);
    return Result.fail(new ValidationError(`Perimeter rasterization failed: ${message}`));
  }
}

/**
 * Checks if GDAL bindings are available.
 *
 * @returns True if gdal-async is installed and working
 */
export async function isGDALAvailable(): Promise<boolean> {
  try {
    const gdalModule = await import('gdal-async');
    const gdal = gdalModule.default;
    // Try to access a GDAL function to verify it's working
    const drivers = gdal.drivers.getNames();
    return drivers.length > 0;
  } catch {
    return false;
  }
}
