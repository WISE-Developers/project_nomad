/**
 * Tests for parsePerimeterGeoJSON (refs #267).
 *
 * Server-side GeoJSON perimeter validator. Replaces client-side parseGeoJSON
 * in frontend/src/features/ModelSetup/components/GeometryUpload.tsx.
 */

import { describe, it, expect } from 'vitest';
import {
  parsePerimeterGeoJSON,
  MULTI_PART_EXPANSIONS,
  PARSER_ACCEPTED_GEOMETRY_TYPES,
} from '../parsePerimeterGeoJSON.js';
import { GeometryType } from '../../../domain/entities/SpatialGeometry.js';
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

    it('ACCEPTS MultiPoint and MultiLineString, now by decomposing them (#547)', () => {
      // CHANGED BY #547, and the original intent is kept: these types must not be
      // DROPPED. What changed is the shape of acceptance — they are decomposed into
      // the single-part types the domain can represent, because neither appears in
      // `GeometryType` or in the rasterizer's list, so passing one through handed a
      // consumer a geometry it could not read. The old assertion was `toHaveLength(1)`
      // for a 2-member MultiPoint, which is pass-through.
      const mp = { type: 'MultiPoint', coordinates: [[-117.7, 61.7], [-117.6, 61.6]] };
      const ml = { type: 'MultiLineString', coordinates: [[[-117.7, 61.7], [-117.6, 61.6]]] };

      const fromMultiPoint = parsePerimeterGeoJSON(JSON.stringify(mp)).features;
      expect(fromMultiPoint).toHaveLength(2);
      expect(fromMultiPoint.map((f) => f.geometry.type)).toEqual(['Point', 'Point']);

      const fromMultiLine = parsePerimeterGeoJSON(JSON.stringify(ml)).features;
      expect(fromMultiLine).toHaveLength(1);
      expect(fromMultiLine[0].geometry.type).toBe('LineString');
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

/**
 * #547 — THE DERIVED GUARD CHAIN.
 *
 * The defect the issue names is that `SUPPORTED_GEOMETRY_TYPES` and the set of types
 * anything downstream can represent are two lists kept in agreement by hand, and they
 * have already drifted once at real cost (#537). There were in fact THREE such lists:
 * this parser's, `GeometryType`, and `PERIMETER_GEOMETRY_TYPES` in PerimeterRasterizer.
 *
 * THE RULE: expand only what the domain cannot represent, and leave the rest WHOLE.
 *
 * MultiPolygon must NOT be decomposed here, and that is the sharp edge of this issue.
 * A model carries ONE ignition geometry (`models.ts` reads a single `body.ignition`),
 * and the engine hands that geometry straight to the rasterizer when it is supported
 * (`FireSTARREngine.ts:661`), where `geometryToWKT` burns every member and every hole
 * into one `perimeter.tif`. A MultiPolygon is therefore representable end to end — it
 * is in `GeometryType` AND in `PERIMETER_GEOMETRY_TYPES` — so splitting a two-lobed
 * fire into two features would mean one lobe reaching the engine and the other being
 * dropped at the single-geometry boundary. The frontend splits them only because its
 * draw layer cannot hold a multi-part feature; that is a display constraint, not the
 * engine's.
 *
 * MultiPoint and MultiLineString are the opposite case: neither appears in the domain
 * enum or in the rasterizer's list, and nothing downstream consumes them. Those are
 * decomposed where the file enters the server, so an upload still works and no
 * consumer ever meets a type it cannot handle — instead of being passed through and
 * normalized by the client, which is the defect class of #539 and which left the MCP
 * and ZIP-import paths with no expansion at all.
 *
 * A hole is an interior RING of one polygon, not a part. Nothing here changes holes —
 * asserted below so the two concerns stay distinct.
 */
describe('#547 — the accepted set and the parser output derive from GeometryType', () => {
  const DOMAIN_TYPES = Object.values(GeometryType) as string[];

  /** One fixture per accepted type. Keyed so a type with no fixture FAILS. */
  const FIXTURES: Record<string, { type: string; coordinates: unknown }> = {
    Point: { type: 'Point', coordinates: [-115.7, 60.8] },
    LineString: {
      type: 'LineString',
      coordinates: [
        [-115.7, 60.8],
        [-115.69, 60.81],
      ],
    },
    Polygon: {
      type: 'Polygon',
      coordinates: [
        [
          [-115.7, 60.8],
          [-115.7, 60.81],
          [-115.69, 60.81],
          [-115.7, 60.8],
        ],
      ],
    },
    MultiPoint: {
      type: 'MultiPoint',
      coordinates: [
        [-115.7, 60.8],
        [-115.6, 60.9],
      ],
    },
    MultiLineString: {
      type: 'MultiLineString',
      coordinates: [
        [
          [-115.7, 60.8],
          [-115.69, 60.81],
        ],
        [
          [-115.5, 60.5],
          [-115.49, 60.51],
        ],
      ],
    },
    MultiPolygon: {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [-115.7, 60.8],
            [-115.7, 60.81],
            [-115.69, 60.81],
            [-115.7, 60.8],
          ],
        ],
        [
          [
            [-115.5, 60.5],
            [-115.5, 60.51],
            [-115.49, 60.51],
            [-115.5, 60.5],
          ],
        ],
      ],
    },
  };

  function parseOne(geometry: unknown) {
    return parsePerimeterGeoJSON(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {}, geometry }],
      }),
    );
  }

  it('CONTROL: the domain enum is non-empty and is what the chain is anchored to', () => {
    // Without this, every "subset of DOMAIN_TYPES" assertion below would pass
    // vacuously if the enum import resolved to an empty object.
    expect(DOMAIN_TYPES.length).toBeGreaterThan(0);
    expect(DOMAIN_TYPES).toContain('Polygon');
    expect(DOMAIN_TYPES).toContain('MultiPolygon');
  });

  it('every expansion target is a GeometryType member', () => {
    const targets = Object.values(MULTI_PART_EXPANSIONS) as string[];
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.filter((t) => !DOMAIN_TYPES.includes(t))).toEqual([]);
  });

  it('WE ONLY EXPAND WHAT THE DOMAIN CANNOT REPRESENT — MultiPolygon is not in the table', () => {
    // The guard that keeps a two-lobed fire whole. If someone "tidies" MultiPolygon
    // into the expansion table for symmetry, this fails and says why.
    const expandable = Object.keys(MULTI_PART_EXPANSIONS);
    const wrongly = expandable.filter((t) => DOMAIN_TYPES.includes(t));
    expect(
      wrongly,
      'these are representable end to end; expanding them loses parts at the single-ignition boundary',
    ).toEqual([]);
    expect(expandable).not.toContain('MultiPolygon');
  });

  it('the accepted set is exactly the domain types plus the expandable ones', () => {
    // The link that stops a fourth hand-kept copy appearing: the accepted set is not
    // allowed to be its own list.
    const expected = [...new Set([...DOMAIN_TYPES, ...Object.keys(MULTI_PART_EXPANSIONS)])].sort();
    expect([...PARSER_ACCEPTED_GEOMETRY_TYPES].sort()).toEqual(expected);
  });

  it('CONTROL: every accepted type has a fixture, so no case is silently skipped', () => {
    const missing = [...PARSER_ACCEPTED_GEOMETRY_TYPES].filter((t) => !(t in FIXTURES));
    expect(missing, 'add a fixture for these before trusting the loop below').toEqual([]);
  });

  it('the parser returns ONLY domain types, for every type it accepts', () => {
    const leaked: string[] = [];

    for (const accepted of PARSER_ACCEPTED_GEOMETRY_TYPES) {
      const out = parseOne(FIXTURES[accepted]);
      expect(out.features.length, `${accepted} parsed to zero features`).toBeGreaterThan(0);
      for (const f of out.features) {
        if (!DOMAIN_TYPES.includes(f.geometry.type)) {
          leaked.push(`${accepted} -> ${f.geometry.type}`);
        }
      }
    }

    expect(leaked, 'these reached a consumer that cannot represent them').toEqual([]);
  });

  it('A TWO-LOBED MultiPolygon STAYS ONE FEATURE — the engine rasterizes it whole', () => {
    const out = parseOne(FIXTURES.MultiPolygon);

    expect(out.features).toHaveLength(1);
    expect(out.features[0].geometry.type).toBe('MultiPolygon');
    expect(
      (out.features[0].geometry as { coordinates: unknown[] }).coordinates,
      'both lobes must survive; one geometry reaches the model and it carries both',
    ).toHaveLength(2);
  });

  it('A HOLE IS A RING, NOT A PART — an unburned island survives untouched', () => {
    // The input Franco named. Part 1 has an exterior ring AND a hole; part 2 is a
    // plain lobe. Nothing may flatten rings into parts, which would turn an island
    // into a second fire.
    const withHole = {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [-115.8, 60.7],
            [-115.8, 60.9],
            [-115.6, 60.9],
            [-115.6, 60.7],
            [-115.8, 60.7],
          ],
          [
            [-115.75, 60.75],
            [-115.75, 60.8],
            [-115.7, 60.8],
            [-115.75, 60.75],
          ],
        ],
        [
          [
            [-115.5, 60.5],
            [-115.5, 60.51],
            [-115.49, 60.51],
            [-115.5, 60.5],
          ],
        ],
      ],
    };

    const out = parseOne(withHole);

    expect(out.features).toHaveLength(1);
    const members = (out.features[0].geometry as { coordinates: unknown[][] }).coordinates;
    expect(members).toHaveLength(2);
    expect(
      members.map((rings) => rings.length),
      'lobe 1 keeps exterior + hole; lobe 2 keeps its single ring',
    ).toEqual([2, 1]);
  });

  it('a single Polygon with a hole is untouched — two rings in, two rings out', () => {
    const polygonWithHole = {
      type: 'Polygon',
      coordinates: [
        [
          [-115.8, 60.7],
          [-115.8, 60.9],
          [-115.6, 60.9],
          [-115.8, 60.7],
        ],
        [
          [-115.75, 60.75],
          [-115.75, 60.8],
          [-115.7, 60.8],
          [-115.75, 60.75],
        ],
      ],
    };

    const out = parseOne(polygonWithHole);

    expect(out.features).toHaveLength(1);
    expect((out.features[0].geometry as { coordinates: unknown[] }).coordinates).toHaveLength(2);
  });

  it('a MultiLineString is decomposed, because nothing downstream represents one', () => {
    const out = parseOne(FIXTURES.MultiLineString);

    expect(out.features).toHaveLength(2);
    expect(out.features.map((f) => f.geometry.type)).toEqual(['LineString', 'LineString']);
  });

  it('a MultiPoint is decomposed for the same reason', () => {
    const out = parseOne(FIXTURES.MultiPoint);

    expect(out.features).toHaveLength(2);
    expect(out.features.map((f) => f.geometry.type)).toEqual(['Point', 'Point']);
  });

  it('properties travel to every part, so a named perimeter stays named', () => {
    const out = parsePerimeterGeoJSON(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { name: 'Hay River', fireId: 'HR-2026-014' },
            geometry: FIXTURES.MultiLineString,
          },
        ],
      }),
    );

    expect(out.features).toHaveLength(2);
    for (const f of out.features) {
      expect(f.properties).toMatchObject({ name: 'Hay River', fireId: 'HR-2026-014' });
    }
  });

  it('the three entry shapes agree: collection, bare Feature, bare geometry', () => {
    const asGeometry = parsePerimeterGeoJSON(JSON.stringify(FIXTURES.MultiLineString));
    const asFeature = parsePerimeterGeoJSON(
      JSON.stringify({ type: 'Feature', properties: {}, geometry: FIXTURES.MultiLineString }),
    );
    const asCollection = parseOne(FIXTURES.MultiLineString);

    for (const [label, out] of [
      ['bare geometry', asGeometry],
      ['bare Feature', asFeature],
      ['collection', asCollection],
    ] as const) {
      expect(out.features.map((f) => f.geometry.type), label).toEqual(['LineString', 'LineString']);
    }
  });

  it('an EMPTY multi-part geometry is all-dropped, not an empty success', () => {
    // #537's lesson applied to expansion: a MultiPoint with no members cannot become
    // anything, and answering 201 with zero features is the silent default that made
    // a broken upload look like an empty file.
    expect(() => parseOne({ type: 'MultiPoint', coordinates: [] })).toThrow(ValidationError);
  });

  it('an EMPTY MultiPolygon is all-dropped too, even though it is not expanded', () => {
    // Kept whole does not mean kept unchecked: a MultiPolygon with no members cannot
    // be rasterized, so passing it through would move the failure to the engine.
    expect(() => parseOne({ type: 'MultiPolygon', coordinates: [] })).toThrow(ValidationError);
  });
});
