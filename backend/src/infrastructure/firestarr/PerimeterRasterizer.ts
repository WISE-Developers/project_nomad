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
    // Dynamic import of gdal-async (ESM wraps exports in .default)
    const gdalModule = await import('gdal-async');
    const gdal = gdalModule.default;

    // Open template raster to get extent and projection info
    const templateDs = await gdal.openAsync(templatePath);
    const geoTransform = templateDs.geoTransform;
    const projection = templateDs.srs?.toWKT() ?? '';
    const width = templateDs.rasterSize.x;
    const height = templateDs.rasterSize.y;

    if (!geoTransform) {
      templateDs.close();
      return Result.fail(new ValidationError('Template raster has no geotransform'));
    }

    // Calculate extent from geotransform
    const minX = geoTransform[0];
    const maxY = geoTransform[3];
    const pixelWidth = geoTransform[1];
    const pixelHeight = geoTransform[5]; // negative
    const maxX = minX + width * pixelWidth;
    const minY = maxY + height * pixelHeight;

    templateDs.close();

    // Create memory dataset with the polygon
    const memDriver = gdal.drivers.get('Memory');
    const memDs = memDriver.create('');

    // Create layer in target CRS (UTM from fuel grid)
    const targetSrs = gdal.SpatialReference.fromWKT(projection);
    const layer = memDs.layers.create('perimeter', targetSrs, gdal.wkbPolygon);

    // Create geometry from WKT (coordinates are in WGS84)
    const wkt = geometryToWKT(geometry);
    const gdalGeom = gdal.Geometry.fromWKT(wkt);

    // Transform polygon from WGS84 to target CRS (UTM)
    const wgs84 = gdal.SpatialReference.fromProj4('+proj=longlat +datum=WGS84 +no_defs');
    const transform = new gdal.CoordinateTransformation(wgs84, targetSrs);
    gdalGeom.transform(transform);

    // Create feature with transformed geometry
    const feature = new gdal.Feature(layer);
    feature.setGeometry(gdalGeom);
    layer.features.add(feature);

    console.log(`[PerimeterRasterizer] Rasterizing polygon to ${outputPath}`);
    console.log(`[PerimeterRasterizer] Template: ${width}x${height}, extent: [${minX}, ${minY}, ${maxX}, ${maxY}]`);

    // Use gdal_rasterize CLI-style API to create output raster
    // -te: target extent, -tr: target resolution, -burn: value, -init: initial value
    // -co TILED=YES: FireSTARR requires tiled TIFF, not striped
    await gdal.rasterizeAsync(outputPath, memDs, [
      '-burn', String(burnValue),
      '-init', '0',
      '-a_nodata', '0',
      '-te', String(minX), String(minY), String(maxX), String(maxY),
      '-tr', String(Math.abs(pixelWidth)), String(Math.abs(pixelHeight)),
      '-ot', 'Byte',
      '-of', 'GTiff',
      '-co', 'TILED=YES',
      '-l', 'perimeter'
    ]);

    // Clean up memory dataset
    memDs.close();

    // Open the result to count burned cells
    const resultDs = await gdal.openAsync(outputPath);
    const band = resultDs.bands.get(1);
    const data = band.pixels.read(0, 0, width, height);
    let burnedCells = 0;
    for (let i = 0; i < data.length; i++) {
      if (data[i] === burnValue) burnedCells++;
    }
    resultDs.close();

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
