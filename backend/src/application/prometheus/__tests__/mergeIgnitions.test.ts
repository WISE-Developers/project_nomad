/**
 * Merging N ignitions into one MultiPolygon (refs #294 slice 4).
 *
 * Franco's decision, verbatim: "yes merge - you can convert the point into
 * a tiny circle polygon. and it will work, make it about a single pixel in
 * the raster size. - including that when telling the user what we did, if
 * we do it."
 *
 * Exercised against the real sage1 multi-ignition fixture (BEST scenario:
 * one POLYGON_OUT, one POINT) as well as synthetic cases, because the
 * end-to-end path through toExecutionOptions is unreachable for that fixture
 * until its own CRS blocker clears (it is also blocked on a polygon weather
 * patch) — this proves the merge itself on real plan data instead.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  GeometryType,
  SpatialGeometry,
  type Position,
} from '../../../domain/entities/index.js';
import { planFgmjImport } from '../planFgmjImport.js';
import { resolveProjection } from '../resolveProjection.js';
import { toIgnitionGeometries, type IgnitionGeometry } from '../toIgnitionGeometry.js';
import {
  mergeIgnitions,
  NOMINAL_POINT_IGNITION_DIAMETER_M,
} from '../mergeIgnitions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA = path.resolve(__dirname, '..', '..', '..', '..', '..', 'test-data');
const fixture = (n: string) => path.join(TEST_DATA, n);
const SAGE1 = 'prometheus_job_sage1_patches_multiignition.fgmj';

/** ESRI:102001 — Canada Albers Equal Area Conic (NAD83), the sample's real CRS. */
const ALBERS =
  '+proj=aea +lat_0=40 +lon_0=-96 +lat_1=50 +lat_2=70 +datum=NAD83 +units=m +no_defs';

/** Great-circle distance in metres — close enough at ~tens of metres. */
function haversineMeters(a: Position, b: Position): number {
  const R = 6371008.8;
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function makePoint(name: string, lon: number, lat: number): IgnitionGeometry {
  return {
    name,
    geometry: new SpatialGeometry({ type: GeometryType.Point, coordinates: [lon, lat] }),
  };
}

function makePolygon(name: string, ring: Position[]): IgnitionGeometry {
  return {
    name,
    geometry: new SpatialGeometry({ type: GeometryType.Polygon, coordinates: [ring] }),
  };
}

const SQUARE_A: Position[] = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
const SQUARE_B: Position[] = [[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]];

describe('mergeIgnitions — refusals', () => {
  it('refuses a single ignition — callers must not reach here for N <= 1', () => {
    expect(() => mergeIgnitions([makePoint('only', 0, 0)])).toThrow(/more than one/i);
  });

  it('refuses a LINE among multiple ignitions, naming it and why', () => {
    const line: IgnitionGeometry = {
      name: 'flank',
      geometry: new SpatialGeometry({
        type: GeometryType.LineString,
        coordinates: [[0, 0], [1, 1]],
      }),
    };
    const poly = makePolygon('perimeter', SQUARE_A);

    expect(() => mergeIgnitions([poly, line])).toThrow(/"flank"/);
    expect(() => mergeIgnitions([poly, line])).toThrow(/buffer width/i);
  });
});

describe('mergeIgnitions — two polygons', () => {
  it('produces a MultiPolygon with one member per ignition, not one polygon with two rings', () => {
    const { geometry } = mergeIgnitions([makePolygon('a', SQUARE_A), makePolygon('b', SQUARE_B)]);

    expect(geometry.type).toBe(GeometryType.MultiPolygon);
    const members = geometry.coordinates as Position[][][];
    expect(members).toHaveLength(2);
    // Each member keeps its OWN ring list — not flattened into one polygon's
    // rings, which would turn the second square into a hole in the first.
    expect(members[0]).toEqual([SQUARE_A]);
    expect(members[1]).toEqual([SQUARE_B]);
  });

  it('names each polygon ignition in its own notice', () => {
    const { notices } = mergeIgnitions([makePolygon('north flank', SQUARE_A), makePolygon('south flank', SQUARE_B)]);
    expect(notices.some((n) => n.includes('"north flank"'))).toBe(true);
    expect(notices.some((n) => n.includes('"south flank"'))).toBe(true);
  });
});

describe('mergeIgnitions — a POINT among multiple becomes a nominal circle', () => {
  it('produces a circular polygon member centred on the original point', () => {
    const lon = -112.2258;
    const lat = 55.678433;
    const { geometry } = mergeIgnitions([makePolygon('perimeter', SQUARE_A), makePoint('spot', lon, lat)]);

    const members = geometry.coordinates as Position[][][];
    expect(members).toHaveLength(2);
    const circleRing = members[1][0];
    expect(circleRing.length).toBeGreaterThanOrEqual(16);
    // Closed ring.
    expect(circleRing[0]).toEqual(circleRing[circleRing.length - 1]);

    // Every vertex sits at the nominal radius from the original point,
    // corrected for longitude shrinking by cos(latitude) — not a naive
    // equal-degree offset, which would be ~44% too narrow east-west at this
    // latitude (cos(55.68°) ≈ 0.5635).
    const radiusMeters = NOMINAL_POINT_IGNITION_DIAMETER_M / 2;
    for (const vertex of circleRing.slice(0, -1)) {
      const d = haversineMeters([lon, lat], vertex as Position);
      expect(d).toBeCloseTo(radiusMeters, 0); // within ~1m
    }
  });

  it('is not a naive equal-degree circle — it corrects longitude for latitude', () => {
    // A naive circle (same degree offset on both axes) is an ellipse once
    // projected onto the ground: narrower east-west by cos(latitude). Check
    // the RAW DEGREE offsets are NOT equal — lon offset must be larger.
    const lon = -112.2258;
    const lat = 55.678433;
    const { geometry } = mergeIgnitions([makePolygon('perimeter', SQUARE_A), makePoint('spot', lon, lat)]);
    const members = geometry.coordinates as Position[][][];
    const circleRing = members[1][0];

    // theta = 0 vertex sits at (lon + dLon, lat) — pure longitude offset.
    const eastVertex = circleRing[0];
    const lonOffsetDeg = Math.abs(eastVertex[0] - lon);
    // theta = pi/2 vertex (index 4 of 16) sits at (lon, lat + dLat) — pure
    // latitude offset.
    const northVertex = circleRing[4];
    const latOffsetDeg = Math.abs(northVertex[1] - lat);

    expect(lonOffsetDeg).toBeGreaterThan(latOffsetDeg);
    // Specifically by very close to 1/cos(latitude).
    const expectedRatio = 1 / Math.cos((lat * Math.PI) / 180);
    expect(lonOffsetDeg / latOffsetDeg).toBeCloseTo(expectedRatio, 2);
  });

  it('names the point ignition, the conversion, and the nominal size in its notice', () => {
    const { notices } = mergeIgnitions([makePolygon('perimeter', SQUARE_A), makePoint('spot fire', 1, 1)]);
    const notice = notices.find((n) => n.includes('"spot fire"'));
    expect(notice).toBeDefined();
    expect(notice).toMatch(/POINT/);
    expect(notice).toMatch(/circle/i);
    expect(notice).toMatch(new RegExp(`${NOMINAL_POINT_IGNITION_DIAMETER_M}\\s*m`));
    expect(notice).toMatch(/nominal/i);
  });
});

describe('mergeIgnitions — three or more', () => {
  it('produces one member per ignition for three polygons', () => {
    const SQUARE_C: Position[] = [[20, 20], [21, 20], [21, 21], [20, 21], [20, 20]];
    const { geometry } = mergeIgnitions([
      makePolygon('a', SQUARE_A),
      makePolygon('b', SQUARE_B),
      makePolygon('c', SQUARE_C),
    ]);
    const members = geometry.coordinates as Position[][][];
    expect(members).toHaveLength(3);
  });
});

describe('mergeIgnitions — on real plan data (sage1 BEST: POLYGON_OUT + POINT)', () => {
  it('merges the fixture’s own two ignitions into one two-member MultiPolygon', async () => {
    const [best] = planFgmjImport(fixture(SAGE1));
    expect(best.ignitions.length).toBeGreaterThan(1);

    const resolved = await resolveProjection(best, ALBERS);
    const geometries = toIgnitionGeometries(resolved);
    expect(geometries.length).toBeGreaterThan(1);

    const { geometry, notices } = mergeIgnitions(geometries);
    expect(geometry.type).toBe(GeometryType.MultiPolygon);
    const members = geometry.coordinates as Position[][][];
    expect(members).toHaveLength(geometries.length);

    // One notice naming each real ignition from the file.
    for (const g of geometries) {
      expect(notices.some((n) => n.includes(`"${g.name}"`))).toBe(true);
    }
  });

  it('the end-to-end path through toExecutionOptions stays unreachable here — still blocked on crs/weather-patch, not on the merge', async () => {
    // Documents the known gap rather than asserting a false success: this
    // fixture never reaches `runnable: true`, so the merge can only be
    // proven directly, as above — not through toExecutionOptions.
    const [best] = planFgmjImport(fixture(SAGE1));
    expect(best.runnable).toBe(false);
    const resolved = await resolveProjection(best, ALBERS);
    expect(resolved.runnable).toBe(false);
    expect(resolved.blockers).toContain('polygonWeatherPatch');
  });
});
