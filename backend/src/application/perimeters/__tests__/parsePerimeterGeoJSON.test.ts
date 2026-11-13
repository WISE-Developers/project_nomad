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

describe('parsePerimeterGeoJSON — structural rules', () => {
  it('accepts a single Feature and wraps it in a FeatureCollection', () => {
    const feature = VALID_FEATURE_COLLECTION.features[0];
    const result = parsePerimeterGeoJSON(JSON.stringify(feature));
    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry.type).toBe('Polygon');
  });

  it('accepts a raw geometry object and wraps it in a Feature + FeatureCollection', () => {
    const geometry = VALID_FEATURE_COLLECTION.features[0].geometry;
    const result = parsePerimeterGeoJSON(JSON.stringify(geometry));
    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry.type).toBe('Polygon');
  });

  it('filters out features whose geometry type is not Point/LineString/Polygon', () => {
    const mixed = {
      type: 'FeatureCollection',
      features: [
        VALID_FEATURE_COLLECTION.features[0],
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'GeometryCollection', geometries: [] },
        },
      ],
    };
    const result = parsePerimeterGeoJSON(JSON.stringify(mixed));
    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry.type).toBe('Polygon');
  });

  it('throws ValidationError when payload is not a Feature, FeatureCollection, or geometry', () => {
    const payload = { type: 'NotAThing', foo: 'bar' };
    expect(() => parsePerimeterGeoJSON(JSON.stringify(payload))).toThrow(ValidationError);
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

  it('surfaces the underlying parse-error hint (token/position)', () => {
    try {
      parsePerimeterGeoJSON('{"type": "FeatureCollection", "features": [,]}');
      expect.fail('expected ValidationError');
    } catch (e) {
      const err = e as ValidationError;
      // V8 SyntaxError messages mention either the offending token or a position
      expect(err.fieldErrors[0].message).toMatch(/token|position|expected/i);
    }
  });

  /**
   * #537. Franco uploaded SS014-25_perimeter_2025-08-01.geojson in the UI and got
   * "Successfully loaded 0 feature(s)" — a 201 with an empty collection, rendered as
   * success. Two defects, and the second is the dangerous one.
   *
   * 1. MultiPolygon was absent from SUPPORTED_GEOMETRY_TYPES. Every NWT VIIRS and GPS
   *    perimeter in hand is a MultiPolygon — a fire with an unburned island, or several
   *    disjoint lobes, cannot be a single Polygon.
   * 2. The FeatureCollection branch FILTERED the unsupported features away and returned
   *    what was left. Filtering every feature out is indistinguishable from an empty
   *    file, so the caller is told it succeeded. A bare Feature carrying the same
   *    geometry threw; only the collection path swallowed it.
   */
  describe('#537 multi-part geometries and the silent filter', () => {
    const multiPolygon = {
      type: 'MultiPolygon',
      coordinates: [[[[-117.74, 61.72], [-117.73, 61.72], [-117.73, 61.71], [-117.74, 61.72]]]],
    };

    it('keeps a MultiPolygon feature — the shape every real perimeter arrives in', () => {
      const fc = JSON.stringify({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: { fire_number: 'SS014-25' }, geometry: multiPolygon }],
      });
      const out = parsePerimeterGeoJSON(fc);
      expect(out.features).toHaveLength(1);
      expect(out.features[0].geometry.type).toBe('MultiPolygon');
      expect(out.features[0].properties?.fire_number).toBe('SS014-25');
    });

    it('keeps a bare MultiPolygon Feature', () => {
      const f = JSON.stringify({ type: 'Feature', properties: {}, geometry: multiPolygon });
      expect(parsePerimeterGeoJSON(f).features).toHaveLength(1);
    });

    it('keeps a bare MultiPolygon geometry object', () => {
      expect(parsePerimeterGeoJSON(JSON.stringify(multiPolygon)).features).toHaveLength(1);
    });

    it('keeps MultiPoint and MultiLineString too, for the same reason', () => {
      const mp = { type: 'MultiPoint', coordinates: [[-117.7, 61.7], [-117.6, 61.6]] };
      const ml = { type: 'MultiLineString', coordinates: [[[-117.7, 61.7], [-117.6, 61.6]]] };
      expect(parsePerimeterGeoJSON(JSON.stringify(mp)).features).toHaveLength(1);
      expect(parsePerimeterGeoJSON(JSON.stringify(ml)).features).toHaveLength(1);
    });

    it('REFUSES a collection whose every feature is unsupported, instead of reporting success', () => {
      const fc = JSON.stringify({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: {}, geometry: { type: 'GeometryCollection', geometries: [] } },
        ],
      });
      expect(() => parsePerimeterGeoJSON(fc)).toThrow(/GeometryCollection/);
    });

    it('names every unsupported type it dropped, so the message is actionable', () => {
      const fc = JSON.stringify({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: {}, geometry: { type: 'GeometryCollection', geometries: [] } },
          { type: 'Feature', properties: {}, geometry: { type: 'Nonsense', coordinates: [] } },
        ],
      });
      expect(() => parsePerimeterGeoJSON(fc)).toThrow(/GeometryCollection.*Nonsense|Nonsense.*GeometryCollection/);
    });

    it('an EMPTY collection is still accepted — empty is not the same as all-dropped', () => {
      const fc = JSON.stringify({ type: 'FeatureCollection', features: [] });
      expect(parsePerimeterGeoJSON(fc).features).toHaveLength(0);
    });

    it('a mixed collection keeps the supported features and does not throw', () => {
      const fc = JSON.stringify({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: {}, geometry: multiPolygon },
          { type: 'Feature', properties: {}, geometry: { type: 'GeometryCollection', geometries: [] } },
        ],
      });
      const out = parsePerimeterGeoJSON(fc);
      expect(out.features).toHaveLength(1);
      expect(out.features[0].geometry.type).toBe('MultiPolygon');
    });
  });
});
