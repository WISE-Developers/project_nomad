/**
 * Tests for parsePerimeterGeoJSON (refs #267).
 *
 * Server-side GeoJSON perimeter validator. Replaces client-side parseGeoJSON
 * in frontend/src/features/ModelSetup/components/GeometryUpload.tsx.
 */

import { describe, it, expect } from 'vitest';
import { parsePerimeterGeoJSON } from '../parsePerimeterGeoJSON.js';
import { ValidationError } from '../../../domain/errors/ValidationError.js';

const VALID_FEATURE_COLLECTION = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-115.7, 60.8],
            [-115.7, 60.81],
            [-115.69, 60.81],
            [-115.69, 60.8],
            [-115.7, 60.8],
          ],
        ],
      },
    },
  ],
};

describe('parsePerimeterGeoJSON — happy path', () => {
  it('accepts a valid FeatureCollection of polygons and returns it', () => {
    const result = parsePerimeterGeoJSON(JSON.stringify(VALID_FEATURE_COLLECTION));

    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry.type).toBe('Polygon');
  });
});

describe('parsePerimeterGeoJSON — invalid JSON', () => {
  it('throws ValidationError for malformed JSON', () => {
    expect(() => parsePerimeterGeoJSON('not json {')).toThrow(ValidationError);
  });

  it('includes a fieldError pointing at the content with a descriptive message', () => {
    try {
      parsePerimeterGeoJSON('not json {');
      expect.fail('expected ValidationError');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      const err = e as ValidationError;
      expect(err.fieldErrors).toHaveLength(1);
      expect(err.fieldErrors[0].field).toBe('content');
      expect(err.fieldErrors[0].message).toMatch(/valid JSON/i);
    }
  });
});
