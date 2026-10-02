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
 * Geometry types the rasterizer (and its callers) can turn into a perimeter
 * raster. Single source of truth for the type gate — FireSTARRInputGenerator
 * and FireSTARREngine's perimeter rule both check against this instead of
 * repeating the Polygon/LineString/MultiPolygon list themselves (refs #294).
 */
export const PERIMETER_GEOMETRY_TYPES: readonly GeometryType[] = [
  GeometryType.Polygon,
  GeometryType.LineString,
  GeometryType.MultiPolygon,
];

/** Whether a geometry type can be rasterized as a FireSTARR perimeter. */
export function isSupportedPerimeterGeometry(type: GeometryType): boolean {
  return PERIMETER_GEOMETRY_TYPES.includes(type);
}

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
  /** Centroid of the polygon in WGS84 (calculated from UTM projection for accuracy) */
  readonly centroid?: { latitude: number; longitude: number };
}

/**
 * Converts geometry coordinates to WKT format.
 * Supports Polygon, LineString, and MultiPolygon geometries.
 */
export function geometryToWKT(geometry: SpatialGeometry): string {
  if (geometry.type === GeometryType.Polygon) {
    const coords = geometry.coordinates as number[][][];
    const rings = coords.map((ring) =>
      ring.map(([x, y]) => `${x} ${y}`).join(', ')
    );
    return `POLYGON((${rings.join('), (')}))`;
  }

  if (geometry.type === GeometryType.MultiPolygon) {
    // One parenthesized group per MEMBER, each wrapped exactly the way a
    // standalone polygon is (exterior ring then holes). GDAL's fromWKT
    // accepts this directly — no new parsing needed upstream.
    const members = geometry.coordinates as number[][][][];
    const memberGroups = members.map((rings) => {
      const ringStrings = rings.map((ring) =>
        ring.map(([x, y]) => `${x} ${y}`).join(', ')
      );
      return `((${ringStrings.join('), (')}))`;
    });
    return `MULTIPOLYGON(${memberGroups.join(', ')})`;
  }

  if (geometry.type === GeometryType.LineString) {
    const coords = geometry.coordinates as number[][];
    const points = coords.map(([x, y]) => `${x} ${y}`).join(', ');
    return `LINESTRING(${points})`;
  }

  throw new Error(`Expected Polygon, LineString, or MultiPolygon geometry, got ${geometry.type}`);
}

/**
 * Rasterizes a line segment into grid cells using Bresenham-style traversal.
 * Returns the set of [col, row] pairs that the line passes through.
 */
function rasterizeLine(
  lineCoords: number[][],
  minX: number,
  maxY: number,
  pixelWidth: number,
  pixelHeight: number,
  width: number,
  height: number
): Set<string> {
  const cells = new Set<string>();

  for (let i = 0; i < lineCoords.length - 1; i++) {
    const x0 = lineCoords[i][0];
    const y0 = lineCoords[i][1];
    const x1 = lineCoords[i + 1][0];
    const y1 = lineCoords[i + 1][1];

    // Sample along the segment at sub-pixel intervals
    const dx = x1 - x0;
    const dy = y1 - y0;
    const segmentLength = Math.sqrt(dx * dx + dy * dy);
    const stepSize = Math.min(pixelWidth, pixelHeight) * 0.5;
    const steps = Math.max(Math.ceil(segmentLength / stepSize), 1);

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = x0 + dx * t;
      const py = y0 + dy * t;

      const col = Math.floor((px - minX) / pixelWidth);
      const row = Math.floor((maxY - py) / pixelHeight);

      if (col >= 0 && col < width && row >= 0 && row < height) {
        cells.add(`${col},${row}`);
      }
    }
  }

  return cells;
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

/** One polygon's own rings — exterior first, holes after, in COORDINATE
 * SPACE (already transformed), never parsed from WKT text. */
interface PolygonMember {
  exterior: number[][];
  holes: number[][][];
  envelope: { minX: number; minY: number; maxX: number; maxY: number };
}

/**
 * Minimal surface of gdal-async's Geometry this module depends on, named
 * explicitly so the structural walk below is typed rather than `any`-typed
 * end to end.
 */
interface GdalRingLike {
  points: { toArray(): { x: number; y: number }[] };
}
interface GdalPolygonLike {
  name: string;
  rings: { count(): number; get(i: number): GdalRingLike };
  getEnvelope(): { minX: number; minY: number; maxX: number; maxY: number };
}
interface GdalMultiPolygonLike {
  name: string;
  children: { count(): number; get(i: number): GdalPolygonLike };
}

function ringToPoints(ring: GdalRingLike): number[][] {
  return ring.points.toArray().map((p) => [p.x, p.y]);
}

function singlePolygonMember(polygon: GdalPolygonLike): PolygonMember {
  const ringCount = polygon.rings.count();
  if (ringCount === 0) {
    throw new Error('Polygon geometry has no rings — cannot determine what to burn.');
  }
  const exterior = ringToPoints(polygon.rings.get(0));
  const holes: number[][][] = [];
  for (let i = 1; i < ringCount; i++) {
    holes.push(ringToPoints(polygon.rings.get(i)));
  }
  return { exterior, holes, envelope: polygon.getEnvelope() };
}

/**
 * Walks a GDAL Polygon or MultiPolygon STRUCTURALLY — via `.rings` and, for
 * a MultiPolygon, `.children` — into one PolygonMember per member, each
 * with its own exterior ring and hole rings kept separate (refs #406).
 *
 * This replaces extracting coordinates by regex-matching the geometry's own
 * WKT text. That regex, `/POLYGON\s*\(\((.+)\)\)/i`, matches a
 * MultiPolygon's WKT too — "MULTIPOLYGON" contains the substring "POLYGON"
 * — and its greedy capture runs to the LAST `))`, merging every member's
 * (and, for an ordinary polygon, every hole's) points into one flat list.
 * Walking the geometry's own structure cannot make that mistake: a
 * MultiPolygon's members and a polygon's holes are never ambiguous here.
 */
function polygonMembersOf(geometry: GdalPolygonLike | GdalMultiPolygonLike): PolygonMember[] {
  if (geometry.name === 'MULTIPOLYGON') {
    const multi = geometry as GdalMultiPolygonLike;
    const count = multi.children.count();
    const members: PolygonMember[] = [];
    for (let i = 0; i < count; i++) {
      members.push(singlePolygonMember(multi.children.get(i)));
    }
    return members;
  }
  return [singlePolygonMember(geometry as GdalPolygonLike)];
}

/** Inside the member's exterior ring and outside every one of its holes. */
function isInsideMember(x: number, y: number, member: PolygonMember): boolean {
  if (!pointInPolygon(x, y, member.exterior)) return false;
  return !member.holes.some((hole) => pointInPolygon(x, y, hole));
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
  if (!isSupportedPerimeterGeometry(geometry.type)) {
    return Result.fail(
      new ValidationError(`Perimeter must be a polygon, linestring, or multipolygon, got ${geometry.type}`)
    );
  }

  const isLineString = geometry.type === GeometryType.LineString;
  const shapeLabel = isLineString ? 'LineString' : geometry.type === GeometryType.MultiPolygon ? 'MultiPolygon' : 'Polygon';

  try {
    // Dynamic import of gdal-async for coordinate transformation
    const gdalModule = await import('gdal-async');
    const gdal = gdalModule.default;

    // Open template raster to get CRS and resolution info
    const templateDs = await gdal.openAsync(templatePath);
    const geoTransform = templateDs.geoTransform;
    const templateSrs = templateDs.srs;

    if (!geoTransform) {
      templateDs.close();
      return Result.fail(new ValidationError('Template raster has no geotransform'));
    }

    if (!templateSrs) {
      templateDs.close();
      return Result.fail(new ValidationError('Template raster has no spatial reference'));
    }

    const pixelWidth = geoTransform[1];
    const pixelHeight = Math.abs(geoTransform[5]); // Make positive for calculations

    // Extract central meridian from template WKT
    // GDAL's toProj4() rounds to standard UTM zones, losing half-zone info
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const templateWkt = (templateSrs as any).toWKT() as string;
    const centralMeridianMatch = templateWkt.match(/Longitude of natural origin[^,]*,\s*([-\d.]+)/i)
      || templateWkt.match(/central_meridian[^,]*,\s*([-\d.]+)/i);

    if (!centralMeridianMatch) {
      templateDs.close();
      return Result.fail(new ValidationError('Could not determine central meridian from template raster'));
    }

    const centralMeridian = parseFloat(centralMeridianMatch[1]);
    templateDs.close();

    // Build PROJ4 string with exact central meridian from template
    const proj4String = `+proj=tmerc +lat_0=0 +lon_0=${centralMeridian} +k=0.9996 +x_0=500000 +y_0=0 +datum=NAD83 +units=m +no_defs`;

    // Create geometry from WKT (coordinates are in WGS84)
    const wkt = geometryToWKT(geometry);
    const gdalGeom = gdal.Geometry.fromWKT(wkt);

    // Transform polygon from WGS84 to target CRS (UTM with correct central meridian)
    const targetSrs = gdal.SpatialReference.fromProj4(proj4String);
    const wgs84 = gdal.SpatialReference.fromProj4('+proj=longlat +datum=WGS84 +no_defs');
    const transform = new gdal.CoordinateTransformation(wgs84, targetSrs);
    gdalGeom.transform(transform);

    // Get polygon centroid and envelope in UTM coordinates
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geomAny = gdalGeom as any;
    const utmCentroid = geomAny.centroid();
    const envelope = geomAny.getEnvelope();
    const centerX = utmCentroid.x as number;
    const centerY = utmCentroid.y as number;

    console.log(`[PerimeterRasterizer] ${shapeLabel} centroid (UTM): ${centerX.toFixed(1)}, ${centerY.toFixed(1)}`);

    // Transform UTM centroid back to WGS84 for use as ignition point
    // This ensures the ignition point matches the perimeter raster center
    const inverseTransform = new gdal.CoordinateTransformation(targetSrs, wgs84);
    const wgs84Centroid = inverseTransform.transformPoint(centerX, centerY);
    const centroidLongitude = wgs84Centroid.x;
    const centroidLatitude = wgs84Centroid.y;
    console.log(`[PerimeterRasterizer] ${shapeLabel} centroid (WGS84): ${centroidLongitude.toFixed(6)}, ${centroidLatitude.toFixed(6)}`);
    console.log(`[PerimeterRasterizer] ${shapeLabel} envelope: [${envelope.minX.toFixed(1)}, ${envelope.minY.toFixed(1)}, ${envelope.maxX.toFixed(1)}, ${envelope.maxY.toFixed(1)}]`);

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

    // Extract transformed coordinates for rasterization
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transformedWkt = (gdalGeom as any).toWKT() as string;

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

    let burnedCells = 0;

    if (isLineString) {
      // LineString rasterization: burn cells along the line
      const coordMatch = transformedWkt.match(/LINESTRING\s*\((.+)\)/i);
      if (!coordMatch) {
        outDs.close();
        return Result.fail(new ValidationError('Failed to extract transformed linestring coordinates'));
      }

      const lineCoords = coordMatch[1].split(',').map(coordStr => {
        const [x, y] = coordStr.trim().split(/\s+/).map(Number);
        return [x, y];
      });

      console.log(`[PerimeterRasterizer] LineString has ${lineCoords.length} vertices`);

      const cells = rasterizeLine(lineCoords, minX, maxY, pixelWidth, pixelHeight, width, height);

      for (const key of cells) {
        const [col, row] = key.split(',').map(Number);
        const pixel = new Uint8Array([burnValue]);
        band.pixels.write(col, row, 1, 1, pixel);
        burnedCells++;
      }
    } else {
      // Polygon/MultiPolygon rasterization: burn cells inside each member's
      // exterior ring, excluding its own hole rings — walking the GDAL
      // geometry's `.rings`/`.children` structurally (see polygonMembersOf).
      // No WKT text parsing, and no silent fallback: if the geometry cannot
      // be walked this way, singlePolygonMember throws and the catch below
      // turns it into a failed Result rather than a wrong burn.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const members = polygonMembersOf(gdalGeom as any);

      const burnedKeys = new Set<string>();

      for (const member of members) {
        const polyMinX = member.envelope.minX;
        const polyMaxX = member.envelope.maxX;
        const polyMinY = member.envelope.minY;
        const polyMaxY = member.envelope.maxY;

        const startCol = Math.max(0, Math.floor((polyMinX - minX) / pixelWidth) - 1);
        const endCol = Math.min(width - 1, Math.ceil((polyMaxX - minX) / pixelWidth) + 1);
        const startRow = Math.max(0, Math.floor((maxY - polyMaxY) / pixelHeight) - 1);
        const endRow = Math.min(height - 1, Math.ceil((maxY - polyMinY) / pixelHeight) + 1);

        console.log(`[PerimeterRasterizer] Member pixel extent: rows ${startRow}-${endRow}, cols ${startCol}-${endCol}`);

        for (let row = startRow; row <= endRow; row++) {
          for (let col = startCol; col <= endCol; col++) {
            const cellX = minX + (col + 0.5) * pixelWidth;
            const cellY = maxY - (row + 0.5) * pixelHeight;
            if (isInsideMember(cellX, cellY, member)) {
              burnedKeys.add(`${col},${row}`);
            }
          }
        }
      }

      // Written once per unique cell — members are not expected to
      // overlap, but a shared cell must still count once, not twice.
      for (const key of burnedKeys) {
        const [col, row] = key.split(',').map(Number);
        band.pixels.write(col, row, 1, 1, new Uint8Array([burnValue]));
      }
      burnedCells = burnedKeys.size;
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
      centroid: { latitude: centroidLatitude, longitude: centroidLongitude },
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
