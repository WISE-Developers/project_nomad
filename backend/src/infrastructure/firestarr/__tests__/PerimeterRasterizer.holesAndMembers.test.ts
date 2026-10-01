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

import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import {
  GeometryType,
  SpatialGeometry,
  type Position,
} from '../../../domain/entities/index.js';
import { rasterizePerimeter, isGDALAvailable } from '../PerimeterRasterizer.js';

// A real fuel-grid tile, used only as a CRS/resolution template — never
// written to. UTM zone 10N, 100m pixels.
const FUEL_TEMPLATE = join(
  '/Volumes/KINGSTON/localcode/sage_workspace/projects/project_nomad',
  'firestarr_data/FireSTARR_Dataset_2025_V1.0/10N_50651/10N_50651.tif',
);

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
