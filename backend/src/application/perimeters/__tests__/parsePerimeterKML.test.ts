/**
 * Tests for parsePerimeterKML (refs #267).
 *
 * Server-side KML perimeter validator. Replaces client-side parseKML
 * in frontend/src/features/ModelSetup/components/GeometryUpload.tsx.
 */

import { describe, it, expect } from 'vitest';
import { parsePerimeterKML } from '../parsePerimeterKML.js';
import { ValidationError } from '../../../domain/errors/ValidationError.js';

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

  it('also extracts Points and LineStrings (frontend parity)', () => {
    const kml = `<?xml version="1.0"?>
      <kml xmlns="http://www.opengis.net/kml/2.2"><Document>
        <Placemark><Point><coordinates>-115.7,60.8</coordinates></Point></Placemark>
        <Placemark><LineString><coordinates>-115.7,60.8 -115.6,60.81</coordinates></LineString></Placemark>
      </Document></kml>`;
    const result = parsePerimeterKML(kml);
    expect(result.features.map((f) => f.geometry.type)).toEqual(['Point', 'LineString']);
  });
});

describe('parsePerimeterKML — structural rules', () => {
  it('throws ValidationError for malformed XML', () => {
    expect(() => parsePerimeterKML('<<not xml>>')).toThrow(ValidationError);
  });

  it('throws ValidationError when no valid geometries are present', () => {
    const emptyKml = `<?xml version="1.0"?>
      <kml xmlns="http://www.opengis.net/kml/2.2"><Document>
        <Placemark><name>no geom</name></Placemark>
      </Document></kml>`;
    expect(() => parsePerimeterKML(emptyKml)).toThrow(ValidationError);
  });

  it('skips a Polygon with fewer than 3 vertices and still throws if no valid geometries remain', () => {
    const badPoly = `<?xml version="1.0"?>
      <kml xmlns="http://www.opengis.net/kml/2.2"><Document>
        <Placemark><Polygon><outerBoundaryIs><LinearRing>
          <coordinates>-115.7,60.8 -115.7,60.81</coordinates>
        </LinearRing></outerBoundaryIs></Polygon></Placemark>
      </Document></kml>`;
    expect(() => parsePerimeterKML(badPoly)).toThrow(ValidationError);
  });
});
