/**
 * Tests for parsePerimeterShapefile (refs #269).
 *
 * Server-side shapefile perimeter validator. Accepts either:
 *   - a zipped bundle containing .shp/.shx/.dbf/.prj
 *   - a raw multi-file payload (record of filename -> Buffer)
 *
 * Returns a normalized WGS84 FeatureCollection in the same shape as
 * parsePerimeterGeoJSON / parsePerimeterKML.
 */

import { describe, it, expect } from 'vitest';
import { parsePerimeterShapefile } from '../parsePerimeterShapefile.js';

describe('parsePerimeterShapefile — module surface', () => {
  it('exports a parsePerimeterShapefile function', () => {
    expect(typeof parsePerimeterShapefile).toBe('function');
  });
});
