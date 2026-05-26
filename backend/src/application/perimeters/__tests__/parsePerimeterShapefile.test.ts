/**
 * Tests for parsePerimeterShapefile (refs #269).
 *
 * Server-side shapefile perimeter validator. Accepts either:
 *   - a zipped bundle (Buffer) containing .shp/.shx/.dbf/.prj
 *   - a raw multi-file payload (record of filename -> Buffer)
 *
 * Returns a normalized WGS84 FeatureCollection in the same shape as
 * parsePerimeterGeoJSON / parsePerimeterKML.
 */

import { describe, it, expect } from 'vitest';
import { parsePerimeterShapefile } from '../parsePerimeterShapefile.js';
import { ValidationError } from '../../../domain/errors/ValidationError.js';
import { buildShapefileFiles, zipShapefileFiles } from './shapefileFixtures.js';

describe('parsePerimeterShapefile — module surface', () => {
  it('exports a parsePerimeterShapefile function', () => {
    expect(typeof parsePerimeterShapefile).toBe('function');
  });
});

describe('parsePerimeterShapefile — sidecar presence (zip)', () => {
  it('throws ValidationError with missing_sidecar when .prj is absent from the zip', async () => {
    const files = buildShapefileFiles();
    delete files['fixture.prj'];
    const zip = zipShapefileFiles(files);

    await expect(parsePerimeterShapefile(zip)).rejects.toThrow(ValidationError);
    try {
      await parsePerimeterShapefile(zip);
    } catch (e) {
      const err = e as ValidationError;
      expect(err.fieldErrors[0].field).toBe('prj');
      expect(err.fieldErrors[0].message).toMatch(/missing/i);
    }
  });
});

describe('parsePerimeterShapefile — sidecar presence (raw multi-file)', () => {
  it('throws ValidationError with missing_sidecar when .shx is absent from a raw payload', async () => {
    const files = buildShapefileFiles();
    delete files['fixture.shx'];

    await expect(parsePerimeterShapefile(files)).rejects.toThrow(ValidationError);
    try {
      await parsePerimeterShapefile(files);
    } catch (e) {
      const err = e as ValidationError;
      expect(err.fieldErrors[0].field).toBe('shx');
      expect(err.fieldErrors[0].message).toMatch(/missing/i);
    }
  });
});

describe('parsePerimeterShapefile — happy path', () => {
  it('parses a single-polygon WGS84 shapefile into a normalized FeatureCollection', async () => {
    const zip = (await import('./shapefileFixtures.js')).zipShapefileFiles(
      (await import('./shapefileFixtures.js')).buildShapefileFiles(),
    );
    const result = await parsePerimeterShapefile(zip);
    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry.type).toBe('Polygon');
    const coords = (result.features[0].geometry as { coordinates: number[][][] }).coordinates;
    expect(coords[0].length).toBeGreaterThanOrEqual(4);
    // First vertex should match the fixture (lon, lat) and be in WGS84 range
    expect(coords[0][0][0]).toBeCloseTo(-115.7, 4);
    expect(coords[0][0][1]).toBeCloseTo(60.8, 4);
  });
});

describe('parsePerimeterShapefile — CRS validation', () => {
  it('throws ValidationError when .prj is present but the CRS is unreadable', async () => {
    const files = buildShapefileFiles();
    // Corrupt the .prj so gdal cannot read a SRS from the layer
    files['fixture.prj'] = Buffer.from('NOT A REAL WKT', 'utf-8');
    const zip = (await import('./shapefileFixtures.js')).zipShapefileFiles(files);

    await expect(parsePerimeterShapefile(zip)).rejects.toThrow(ValidationError);
    try {
      await parsePerimeterShapefile(zip);
    } catch (e) {
      const err = e as ValidationError;
      expect(err.fieldErrors[0].field).toBe('prj');
      expect(err.fieldErrors[0].message).toMatch(/crs|projection|srs|unreadable/i);
    }
  });
});

describe('parsePerimeterShapefile — geometry type validation', () => {
  it('throws ValidationError when the shapefile contains points instead of polygons', async () => {
    const files = buildShapefileFiles({
      geometry: 'point',
      coordinates: [[-115.7, 60.8]],
    });
    const zip = (await import('./shapefileFixtures.js')).zipShapefileFiles(files);

    await expect(parsePerimeterShapefile(zip)).rejects.toThrow(ValidationError);
    try {
      await parsePerimeterShapefile(zip);
    } catch (e) {
      const err = e as ValidationError;
      expect(err.fieldErrors[0].field).toBe('geometry');
      expect(err.fieldErrors[0].message).toMatch(/polygon|multipolygon/i);
    }
  });
});

describe('parsePerimeterShapefile — coordinate range validation', () => {
  it('throws ValidationError when reprojected coordinates fall outside plausible WGS84 range', async () => {
    // Build a polygon declared in WGS84 but with longitude values outside [-180, 180].
    const files = buildShapefileFiles({
      coordinates: [
        [500, 60.8],
        [500, 60.81],
        [501, 60.81],
        [501, 60.8],
        [500, 60.8],
      ],
    });
    const zip = (await import('./shapefileFixtures.js')).zipShapefileFiles(files);

    await expect(parsePerimeterShapefile(zip)).rejects.toThrow(ValidationError);
    try {
      await parsePerimeterShapefile(zip);
    } catch (e) {
      const err = e as ValidationError;
      expect(err.fieldErrors[0].field).toBe('coordinates');
      expect(err.fieldErrors[0].message).toMatch(/range|outside|plausible|wgs84|lon|lat/i);
    }
  });
});
