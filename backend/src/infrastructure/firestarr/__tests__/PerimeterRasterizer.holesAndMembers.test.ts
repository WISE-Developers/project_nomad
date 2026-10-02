/**
 * Perimeter burning must walk the GDAL geometry STRUCTURALLY, never by
 * parsing its WKT text with a regex (refs #406).
 *
 * The old `/POLYGON\s*\(\((.+)\)\)/i` regex matches a MULTIPOLYGON's own WKT
 * too — "MULTIPOLYGON" contains the substring "POLYGON" — and its greedy
 * capture runs to the LAST `))`, merging every member's rings (and, for an
 * ordinary polygon, every hole) into one point list. Tokens like "(0" then
 * fail `Number(...)`, becoming NaN, and a NaN comparison is always false —
 * so burning silently produces wrong, sometimes-empty results instead of
 * failing loudly.
 *
 * This asserts on BURNED CELL COUNTS, not just that rasterization completes:
 * - A polygon with a hole must burn strictly fewer cells than the same
 *   polygon without the hole (the hole must not be burned).
 * - Two disjoint MultiPolygon members must burn roughly the SUM of burning
 *   each alone, and the sum must be far smaller than the pixel count of a
 *   bounding box spanning both — proving each member is tested on its own
 *   footprint, not flattened into one shape.
 */

import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import {
  GeometryType,
  SpatialGeometry,
  type Position,
} from '../../../domain/entities/index.js';
import { rasterizePerimeter, isGDALAvailable } from '../PerimeterRasterizer.js';

/**
 * The CRS/resolution template, SYNTHESIZED rather than read off disk.
 *
 * This used to be an absolute path to a real fuel tile under
 * `firestarr_data/`, on the volume the author happened to be working from.
 * `firestarr_data/` is gitignored, so that file exists on exactly one machine:
 * every `rasterizePerimeter` call returned `success: false` in CI and the three
 * cell-count assertions below failed as `expected false to be true`. Green
 * locally, red in CI, for a test whose whole job is guarding a production
 * defect (#406, the silently-burned island).
 *
 * Deliberately NOT solved by skipping when the tile is absent. That would make
 * the suite pass in CI by testing nothing, which is how a regression in #406
 * would reach production unnoticed.
 *
 * The burned-cell counts are purely geometric -- 77 is a 7x11 pixel footprint,
 * since 0.01 deg of longitude at 50 deg N is ~716 m and 0.01 deg of latitude is
 * ~1113 m, against 100 m pixels. Nothing reads the template's PIXEL VALUES, only
 * its CRS, pixel size and grid phase. So a synthesized raster carrying the real
 * tile's projection (NAD83 / UTM 10N), its 100 m pixels and an origin on the same
 * 100 m grid is equivalent for this purpose -- which the unchanged pinned counts
 * of 77 and 65 demonstrate.
 */
const TEMPLATE_EPSG = 26910; // NAD83 / UTM zone 10N, as the real tiles use
const TEMPLATE_PIXEL_M = 100;
/**
 * Origin on the same 100 m grid as the real tile (300000, 9400000), so pixel
 * boundaries fall in the same places and the pinned counts are unaffected.
 * The window covers every geometry in this file: eastings ~500000-516500 and
 * northings ~5538000-5561500 for lon -123.0..-122.77, lat 50.0..50.21.
 */
const TEMPLATE_ORIGIN_X = 490000;
const TEMPLATE_ORIGIN_Y = 5575000;
const TEMPLATE_WIDTH_PX = 400;
const TEMPLATE_HEIGHT_PX = 500;

let templateDir: string;
let FUEL_TEMPLATE: string;

/** Writes a minimal single-band GeoTIFF to stand in for a fuel tile. */
async function createTemplate(targetPath: string): Promise<void> {
  const gdal = await import('gdal-async');
  const dataset = gdal.drivers
    .get('GTiff')
    .create(targetPath, TEMPLATE_WIDTH_PX, TEMPLATE_HEIGHT_PX, 1, gdal.GDT_Byte);
  try {
    dataset.srs = gdal.SpatialReference.fromEPSG(TEMPLATE_EPSG);
    dataset.geoTransform = [
      TEMPLATE_ORIGIN_X,
      TEMPLATE_PIXEL_M,
      0,
      TEMPLATE_ORIGIN_Y,
      0,
      -TEMPLATE_PIXEL_M,
    ];
    const band = dataset.bands.get(1);
    band.noDataValue = 0;
    // Uniform "fuel present". Values are not read by the burn path, but an
    // all-nodata grid would be a misleading fixture to leave behind.
    band.fill(1);
    dataset.flush();
  } finally {
    dataset.close();
  }
}

function square(lon: number, lat: number, sizeDeg: number): Position[] {
  return [
    [lon, lat],
    [lon + sizeDeg, lat],
    [lon + sizeDeg, lat + sizeDeg],
    [lon, lat + sizeDeg],
    [lon, lat],
  ];
}

// ~1.1km square at this latitude (100m pixels -> roughly an 11x11 burn).
const BOX_SIZE_DEG = 0.01;
// A hole covering the middle third of the box, well clear of the exterior
// ring so rounding at the boundary cannot make the test flaky.
const HOLE_SIZE_DEG = BOX_SIZE_DEG / 3;

describe('rasterizePerimeter — structural burning (refs #406)', () => {
  let tempDir: string;
  let gdalAvailable: boolean;

  beforeAll(async () => {
    templateDir = await mkdtemp(join(tmpdir(), 'perimeter-template-'));
    FUEL_TEMPLATE = join(templateDir, 'template.tif');
    await createTemplate(FUEL_TEMPLATE);
  });

  afterAll(async () => {
    if (templateDir) await rm(templateDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it('confirms GDAL is actually available in this environment (precondition, not the thing under test)', async () => {
    gdalAvailable = await isGDALAvailable();
    expect(gdalAvailable).toBe(true);
  });

  describe('a polygon with a hole', () => {
    it('burns strictly fewer cells than the same polygon without the hole', async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'perimeter-hole-test-'));
      const lon = -123.0;
      const lat = 50.0;
      const exterior = square(lon, lat, BOX_SIZE_DEG);
      const hole = square(
        lon + BOX_SIZE_DEG / 2 - HOLE_SIZE_DEG / 2,
        lat + BOX_SIZE_DEG / 2 - HOLE_SIZE_DEG / 2,
        HOLE_SIZE_DEG,
      ).reverse(); // hole winding is irrelevant to GDAL's ring semantics here; reversed to show it isn't winding-order-dependent

      const withoutHole = new SpatialGeometry({
        type: GeometryType.Polygon,
        coordinates: [exterior],
      });
      const withHole = new SpatialGeometry({
        type: GeometryType.Polygon,
        coordinates: [exterior, hole],
      });

      const resultA = await rasterizePerimeter({
        geometry: withoutHole,
        templatePath: FUEL_TEMPLATE,
        outputPath: join(tempDir, 'no-hole.tif'),
      });
      const resultB = await rasterizePerimeter({
        geometry: withHole,
        templatePath: FUEL_TEMPLATE,
        outputPath: join(tempDir, 'with-hole.tif'),
      });

      expect(resultA.success).toBe(true);
      expect(resultB.success).toBe(true);
      if (!resultA.success || !resultB.success) return;

      expect(resultB.value.burnedCells).toBeLessThan(resultA.value.burnedCells);

      // Exact pin, not a loose area-fraction check — a fraction-range check
      // alone does NOT discriminate here: the old WKT-regex code merged the
      // hole ring into the exterior's point list and, for this exact
      // geometry, coincidentally ALSO reduced the count (77 -> 56, a 27%
      // drop) just not correctly — it burns the wrong 56, not the hole's
      // complement. Only the exact count tells them apart. These two values
      // were computed once against this structural implementation on this
      // exact geometry and template; a correctness regression here changes
      // the number, which is the point.
      expect(resultA.value.burnedCells).toBe(77);
      expect(resultB.value.burnedCells).toBe(65);
    });
  });

  describe('a MultiPolygon with two disjoint members', () => {
    it('burns roughly the sum of burning each member alone, not a bounding box spanning both', async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'perimeter-multi-member-test-'));

      // Far enough apart that a bounding box spanning both would be ~20x
      // larger in each dimension than either square — ~400x the pixel
      // count of the sum, if the bug were "fill the bounding box" rather
      // than "test each member's own footprint".
      const squareA = square(-123.0, 50.0, BOX_SIZE_DEG);
      const squareB = square(-122.78, 50.2, BOX_SIZE_DEG);

      const geomA = new SpatialGeometry({ type: GeometryType.Polygon, coordinates: [squareA] });
      const geomB = new SpatialGeometry({ type: GeometryType.Polygon, coordinates: [squareB] });
      const geomBoth = new SpatialGeometry({
        type: GeometryType.MultiPolygon,
        coordinates: [[squareA], [squareB]],
      });

      const resultA = await rasterizePerimeter({
        geometry: geomA,
        templatePath: FUEL_TEMPLATE,
        outputPath: join(tempDir, 'a.tif'),
      });
      const resultB = await rasterizePerimeter({
        geometry: geomB,
        templatePath: FUEL_TEMPLATE,
        outputPath: join(tempDir, 'b.tif'),
      });
      const resultBoth = await rasterizePerimeter({
        geometry: geomBoth,
        templatePath: FUEL_TEMPLATE,
        outputPath: join(tempDir, 'both.tif'),
      });

      expect(resultA.success).toBe(true);
      expect(resultB.success).toBe(true);
      expect(resultBoth.success).toBe(true);
      if (!resultA.success || !resultB.success || !resultBoth.success) return;

      expect(resultA.value.burnedCells).toBeGreaterThan(0);
      expect(resultB.value.burnedCells).toBeGreaterThan(0);

      const sum = resultA.value.burnedCells + resultB.value.burnedCells;

      // Exact equality, not just "roughly the sum": two identical, disjoint
      // squares at this scale reproject near-identically, so testing each
      // member on its own footprint gives EXACTLY the sum of burning each
      // alone (77 + 77 = 154, measured). The old WKT-regex code did not
      // merely approximate this — it burned 1903 cells, ~12x the sum, by
      // merging both members' point lists into one ring and filling
      // whatever that self-intersecting shape enclosed between them. Any
      // value other than the exact sum here means something is burning
      // more (or less) than each member's own footprint again.
      expect(resultBoth.value.burnedCells).toBe(sum);

      // Still worth stating explicitly: a bounding box spanning both
      // squares would be roughly 20x wider and taller than either square
      // (0.22 degrees vs 0.01), i.e. on the order of 100x-400x the pixel
      // area — nowhere near the sum.
      expect(resultBoth.value.burnedCells).toBeLessThan(sum * 10);
    });
  });

  describe('LineString — unchanged by this fix', () => {
    it('still rasterizes a line into a nonzero number of cells', async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'perimeter-line-test-'));
      const geometry = new SpatialGeometry({
        type: GeometryType.LineString,
        coordinates: [[-123.0, 50.0], [-122.99, 50.01]],
      });

      const result = await rasterizePerimeter({
        geometry,
        templatePath: FUEL_TEMPLATE,
        outputPath: join(tempDir, 'line.tif'),
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.value.burnedCells).toBeGreaterThan(0);
    });
  });
});
