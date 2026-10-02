/**
 * MultiPolygon reaching the rasterizer (refs #294 slice 3).
 *
 * FireSTARR never receives vector geometry — only a perimeter raster. Two
 * merged ignitions burn as one TIF once `geometryToWKT` emits MULTIPOLYGON
 * and the type gates stop rejecting it. GDAL's `fromWKT` accepts
 * MULTIPOLYGON directly, so no new parsing is needed upstream of this.
 */

import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import {
  GeometryType,
  SpatialGeometry,
  type MultiPolygonCoordinates,
} from '../../../domain/entities/index.js';
import {
  geometryToWKT,
  rasterizePerimeter,
} from '../PerimeterRasterizer.js';

const TWO_SQUARES: MultiPolygonCoordinates = [
  [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
  [[[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]]],
];

describe('geometryToWKT — MultiPolygon', () => {
  it('emits one MULTIPOLYGON with one parenthesized group per member', () => {
    const geometry = new SpatialGeometry({
      type: GeometryType.MultiPolygon,
      coordinates: TWO_SQUARES,
    });
    const wkt = geometryToWKT(geometry);
    expect(wkt).toMatch(/^MULTIPOLYGON\(/);
    expect(wkt).toBe(
      'MULTIPOLYGON(((0 0, 1 0, 1 1, 0 1, 0 0)), ((10 10, 11 10, 11 11, 10 11, 10 10)))',
    );
  });

  it('still emits a plain POLYGON for an ordinary Polygon (unchanged)', () => {
    const geometry = new SpatialGeometry({
      type: GeometryType.Polygon,
      coordinates: TWO_SQUARES[0],
    });
    const wkt = geometryToWKT(geometry);
    expect(wkt).toBe('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))');
    expect(wkt).not.toMatch(/^MULTI/);
  });

  it('still emits a plain LINESTRING for a LineString (unchanged)', () => {
    const geometry = new SpatialGeometry({
      type: GeometryType.LineString,
      coordinates: [[0, 0], [1, 1]],
    });
    expect(geometryToWKT(geometry)).toBe('LINESTRING(0 0, 1 1)');
  });

  it('still throws for an unsupported geometry type (e.g. Point)', () => {
    const geometry = new SpatialGeometry({
      type: GeometryType.Point,
      coordinates: [0, 0],
    });
    expect(() => geometryToWKT(geometry)).toThrow(/Polygon|LineString|MultiPolygon/);
  });
});

describe('rasterizePerimeter — accepts MultiPolygon past the type gate', () => {
  let tempDir: string;

  it('does not reject a MultiPolygon as an unsupported perimeter type', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'perimeter-merged-fire-test-'));
    const geometry = new SpatialGeometry({
      type: GeometryType.MultiPolygon,
      coordinates: TWO_SQUARES,
    });

    const result = await rasterizePerimeter({
      geometry,
      // Deliberately nonexistent — we are asserting the type gate lets this
      // through, not exercising the full GDAL pipeline, which needs a real
      // fuel-grid template. A rejection here must be about the template
      // file, never about the geometry's type.
      templatePath: join(tempDir, 'does-not-exist.tif'),
      outputPath: join(tempDir, 'out.tif'),
    });

    await rm(tempDir, { recursive: true, force: true });

    expect(result.success).toBe(false);
    if (!result.success) {
      // A type-gate rejection names the geometry's own type; a rejection
      // past the gate is about the (deliberately missing) template file
      // instead, and never mentions MultiPolygon at all.
      expect(result.error.message).not.toMatch(/multipolygon/i);
      expect(result.error.message).toMatch(/does-not-exist\.tif|no such file/i);
    }
  });
});
