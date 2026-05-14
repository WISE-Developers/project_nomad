/**
 * Tests for parsePerimeterKML (refs #267).
 *
 * Server-side KML perimeter validator. Replaces client-side parseKML
 * in frontend/src/features/ModelSetup/components/GeometryUpload.tsx.
 */

import { describe, it, expect } from 'vitest';
import { parsePerimeterKML } from '../parsePerimeterKML.js';

const VALID_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Test Polygon</name>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>
              -115.7,60.8 -115.7,60.81 -115.69,60.81 -115.69,60.8 -115.7,60.8
            </coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`;

describe('parsePerimeterKML — happy path', () => {
  it('extracts a polygon from a valid KML document', () => {
    const result = parsePerimeterKML(VALID_KML);
    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry.type).toBe('Polygon');
    const coords = (result.features[0].geometry as { coordinates: number[][][] }).coordinates;
    expect(coords[0]).toHaveLength(5);
    expect(coords[0][0]).toEqual([-115.7, 60.8]);
  });
});
