/**
 * Perimeter Rasterizer for FireSTARR
 *
 * Converts polygon geometries to GeoTIFF rasters for FireSTARR perimeter input.
 * Uses GDAL via gdal-async for rasterization.
 *
 * Requirements:
 * - Output raster must align with fuel grid (same CRS, cell size, extent)
 * - Non-zero cell values = burned area
 * - Zero or NoData = unburned
 */

import { SpatialGeometry, GeometryType } from '../../domain/entities/index.js';
import { Result } from '../../application/common/index.js';
import { ValidationError } from '../../domain/errors/index.js';

/**
 * Options for perimeter rasterization.
 */
export interface RasterizeOptions {
  /** Polygon geometry to rasterize */
  readonly geometry: SpatialGeometry;
  /** Path to fuel grid template (for extent/CRS/resolution) */
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
 * Rasterizes a polygon geometry to a GeoTIFF.
 *
 * Note: This implementation requires gdal-async to be installed.
 * If GDAL is not available, it will return an error result.
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
    // Dynamic import of gdal-async
    const gdal = await import('gdal-async');

    // Open template raster to get extent and projection
    const templateDs = await gdal.openAsync(templatePath);
    const geoTransform = templateDs.geoTransform;
    const projection = templateDs.srs?.toWKT() ?? '';
    const width = templateDs.rasterSize.x;
    const height = templateDs.rasterSize.y;

    if (!geoTransform) {
      templateDs.close();
      return Result.fail(new ValidationError('Template raster has no geotransform'));
    }

    // Create output raster
    const driver = gdal.drivers.get('GTiff');
    const outputDs = driver.create(outputPath, width, height, 1, gdal.GDT_Byte);

    // Set projection and geotransform to match template
    outputDs.geoTransform = geoTransform;
    if (projection) {
      outputDs.srs = gdal.SpatialReference.fromWKT(projection);
    }

    // Get the band and fill with 0
    const band = outputDs.bands.get(1);
    band.fill(0);
    band.noDataValue = 0;

    // Create memory layer with the polygon
    const memDriver = gdal.drivers.get('Memory');
    const memDs = memDriver.create('');
    const layer = memDs.layers.create('perimeter', gdal.SpatialReference.fromWKT(projection), gdal.wkbPolygon);

    // Create feature from WKT
    const wkt = geometryToWKT(geometry);
    const gdalGeom = gdal.Geometry.fromWKT(wkt);
    const feature = new gdal.Feature(layer);
    feature.setGeometry(gdalGeom);
    layer.features.add(feature);

    // Rasterize the layer
    await gdal.rasterizeAsync(outputDs, memDs, [layer.name], {
      bands: [1],
      burnValues: [burnValue],
    });

    // Count burned cells
    const data = band.pixels.read(0, 0, width, height);
    let burnedCells = 0;
    for (let i = 0; i < data.length; i++) {
      if (data[i] === burnValue) burnedCells++;
    }

    // Clean up
    outputDs.flush();
    outputDs.close();
    templateDs.close();
    memDs.close();

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
    const gdal = await import('gdal-async');
    // Try to access a GDAL function to verify it's working
    const drivers = gdal.drivers.getNames();
    return drivers.length > 0;
  } catch {
    return false;
  }
}
