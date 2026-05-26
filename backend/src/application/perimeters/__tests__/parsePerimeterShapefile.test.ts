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
