/**
 * #539 / #540 / #541 — multi-part geometry is expanded AT THE BOUNDARY.
 *
 * WHY HERE AND NOT IN THE THREE LAYERS BELOW. `DrawnFeature` is
 * `Feature<Point> | Feature<LineString> | Feature<Polygon>` — a union of
 * single-part features (`features/Map/types/geometry.ts:19`). Nothing downstream
 * can describe a MultiPolygon, so teaching `toRequestedIgnitions`,
 * `ignitionLatitude` and `getBoundsFromFeatures` about multi-part means widening
 * that type and then handling the wider type in every consumer — four sites found
 * by hand, one symptom at a time, and `tsc` rejects the attempt outright because
 * the geometry narrows to `never`.
 *
 * Expanding where the data ENTERS means every layer below keeps the single-part
 * guarantee it was written against, and the fix is one implementation rather than
 * a list to keep in step.
 *
 * TWO BOUNDARIES, because a fix applied to one member of a class is not applied
 * to the other:
 *
 *   GeometryUpload.tsx  the perimeter upload. `(await res.json()) as { features:
 *                       DrawnFeature[] }` — a BARE CAST. The server returns
 *                       whatever parsePerimeterGeoJSON admitted, MultiPolygon
 *                       included, and the cast asserts it is single-part. This is
 *                       where #539's symptom came from: the perimeter drew on the
 *                       map and then "No ignition was drawn or imported".
 *   fromImportPlan.ts   the .fgmj scenario import, which refuses multi-part
 *                       honestly today via DRAWING_MODES.
 *
 * Every NWT VIIRS and GPS perimeter is a MultiPolygon — a fire with an unburned
 * island, or several disjoint lobes, cannot be a single Polygon. So this is the
 * normal case, not an edge one.
 */

import { describe, it, expect } from 'vitest';
import { expandMultiPartFeatures } from '../expandMultiPartFeatures';

/** A closed square ring at the given longitude. */
const ring = (lon: number): number[][] => [
  [lon, 60],
  [lon + 0.1, 60],
  [lon + 0.1, 60.1],
  [lon, 60.1],
  [lon, 60],
];

/** A hole inside ring(lon) — an unburned island. */
const hole = (lon: number): number[][] => [
  [lon + 0.02, 60.02],
  [lon + 0.04, 60.02],
  [lon + 0.04, 60.04],
  [lon + 0.02, 60.04],
  [lon + 0.02, 60.02],
];

function feature(geometry: { type: string; coordinates: unknown }, name = 'perimeter') {
  return { type: 'Feature' as const, properties: { name }, geometry };
}

describe('#539 — MultiPolygon expands to one feature per part', () => {
  it('two disjoint lobes become two polygon features, in order', () => {
    const { features, unsupported } = expandMultiPartFeatures([
      feature({ type: 'MultiPolygon', coordinates: [[ring(-117)], [ring(-116)]] }),
    ]);

    expect(unsupported).toEqual([]);
    expect(features).toHaveLength(2);
    expect(features.map((f) => f.geometry.type)).toEqual(['Polygon', 'Polygon']);
    // Order preserved: part 0 then part 1, so what the operator sees on the map
    // matches what the file declared.
    expect((features[0].geometry.coordinates as number[][][])[0][0]).toEqual([-117, 60]);
    expect((features[1].geometry.coordinates as number[][][])[0][0]).toEqual([-116, 60]);
  });

  it('THE DISCRIMINATOR: a hole stays a hole, it does not become a second polygon', () => {
    // Collapsing the rings of one part into separate polygons would BURN THE
    // ISLAND — the unburned centre would be modelled as fuel. This is the
    // assertion that distinguishes expanding from flattening.
    const { features } = expandMultiPartFeatures([
      feature({ type: 'MultiPolygon', coordinates: [[ring(-117), hole(-117)]] }),
    ]);

    expect(features).toHaveLength(1);
    const rings = features[0].geometry.coordinates as number[][][];
    expect(rings).toHaveLength(2);
    expect(rings[1][0]).toEqual([-116.98, 60.02]);
  });

  it('a single-part MultiPolygon still becomes exactly one polygon', () => {
    const { features } = expandMultiPartFeatures([
      feature({ type: 'MultiPolygon', coordinates: [[ring(-117)]] }),
    ]);
    expect(features).toHaveLength(1);
    expect(features[0].geometry.type).toBe('Polygon');
  });
});

describe('#539 — the other multi-part types expand the same way', () => {
  it('MultiPoint becomes one point feature per coordinate', () => {
    const { features } = expandMultiPartFeatures([
      feature({ type: 'MultiPoint', coordinates: [[-117, 60], [-116, 61]] }),
    ]);

    expect(features).toHaveLength(2);
    expect(features.map((f) => f.geometry.type)).toEqual(['Point', 'Point']);
    expect(features[1].geometry.coordinates).toEqual([-116, 61]);
  });

  it('MultiLineString becomes one line feature per line', () => {
    const { features } = expandMultiPartFeatures([
      feature({ type: 'MultiLineString', coordinates: [ring(-117), ring(-116)] }),
    ]);

    expect(features).toHaveLength(2);
    expect(features.map((f) => f.geometry.type)).toEqual(['LineString', 'LineString']);
  });
});

describe('#539 — single-part input is untouched', () => {
  it('passes Point, LineString and Polygon through unchanged', () => {
    const { features, unsupported } = expandMultiPartFeatures([
      feature({ type: 'Point', coordinates: [-117, 60] }),
      feature({ type: 'LineString', coordinates: ring(-117) }),
      feature({ type: 'Polygon', coordinates: [ring(-117)] }),
    ]);

    expect(unsupported).toEqual([]);
    expect(features.map((f) => f.geometry.type)).toEqual(['Point', 'LineString', 'Polygon']);
  });
});

describe('#539 — nothing is dropped in silence (the #537 lesson)', () => {
  it('reports an unrepresentable geometry type instead of discarding it', () => {
    // #537 was a filtered-to-nothing collection returning a 201 the UI rendered
    // as "Successfully loaded 0 feature(s)". A drop that reports success is the
    // failure; naming what could not be carried is the fix.
    const { features, unsupported } = expandMultiPartFeatures([
      feature({ type: 'GeometryCollection', coordinates: undefined }, 'odd one'),
    ]);

    expect(features).toEqual([]);
    expect(unsupported).toHaveLength(1);
    expect(unsupported[0]).toContain('GeometryCollection');
  });

  it('carries the representable parts AND reports the rest in a mixed collection', () => {
    const { features, unsupported } = expandMultiPartFeatures([
      feature({ type: 'MultiPolygon', coordinates: [[ring(-117)], [ring(-116)]] }),
      feature({ type: 'GeometryCollection', coordinates: undefined }, 'odd one'),
    ]);

    expect(features).toHaveLength(2);
    expect(unsupported).toHaveLength(1);
  });

  it('an empty multi-part geometry is reported, not treated as success', () => {
    // A MultiPolygon with no parts yields no features. Returning silently would
    // be the all-dropped case wearing an empty input's clothes.
    const { features, unsupported } = expandMultiPartFeatures([
      feature({ type: 'MultiPolygon', coordinates: [] }),
    ]);

    expect(features).toEqual([]);
    expect(unsupported).toHaveLength(1);
  });
});

describe('#539 — properties survive, because TerraDraw needs them', () => {
  it('gives every expanded part the drawing mode for its own geometry', () => {
    // A feature without `properties.mode` is ignored by TerraDraw, so an
    // imported ignition simply would not appear on the map.
    const { features } = expandMultiPartFeatures([
      feature({ type: 'MultiPolygon', coordinates: [[ring(-117)], [ring(-116)]] }, 'SS014-25'),
    ]);

    for (const f of features) {
      expect(f.properties?.mode).toBe('polygon');
      expect(f.properties?.name).toBe('SS014-25');
    }
  });

  it('preserves any other properties the caller had set', () => {
    const { features } = expandMultiPartFeatures([
      {
        type: 'Feature' as const,
        properties: { name: 'p', inputMethod: 'upload', fileName: 'ss014.geojson' },
        geometry: { type: 'MultiPolygon', coordinates: [[ring(-117)]] },
      },
    ]);

    expect(features[0].properties?.inputMethod).toBe('upload');
    expect(features[0].properties?.fileName).toBe('ss014.geojson');
  });
});
