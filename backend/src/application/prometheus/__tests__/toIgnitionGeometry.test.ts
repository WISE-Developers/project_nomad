/**
 * Turning an imported ignition into geometry FireSTARR can burn (refs #294).
 *
 * An imported fire must burn exactly as a normally-created Nomad model does, so
 * this produces the same SpatialGeometry domain object POST /models builds from
 * a request body. Nothing bespoke.
 *
 * A 381-vertex perimeter is a POLYGON. Handing the engine one vertex of it
 * would start the fire at an arbitrary corner of its own perimeter.
 *
 * HOLES ARE NOT OPTIONAL TO GET RIGHT. The schema flags them —
 * Math.XYPolySet.PolySetEntry.isHole — so an unburned island inside a fire is
 * stated, not inferred from winding order. Dropping one burns ground the
 * original left standing: a bigger fire than the file describes, from a run
 * that completes and looks plausible.
 *
 * Shape comes from the schema's own enum,
 * CwfgmIgnition.IgnitionPoint.IgnitionShape:
 *
 *   UNKNOWN 0   POINT 1   LINE 2   POLYGON_OUT 3   POLYGON_IN 4
 *
 * POLYGON_IN burns INWARD from the perimeter. Geometrically identical to
 * POLYGON_OUT, so mapping both to Polygon loses the distinction — recorded as
 * a divergence rather than flattened silently.
 *
 * UNKNOWN is zero, so proto3 omits it: an absent polyType is a shape the file
 * never stated, which cannot be guessed.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { planFgmjImport, type ScenarioImportPlan } from '../planFgmjImport.js';
import { resolveProjection } from '../resolveProjection.js';
import { toIgnitionGeometries } from '../toIgnitionGeometry.js';
import { GeometryType } from '../../../domain/entities/SpatialGeometry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA = path.resolve(__dirname, '..', '..', '..', '..', '..', 'test-data');
const fixture = (n: string) => path.join(TEST_DATA, n);
const THREE = 'prometheus_job_SS008-25_3scenarios.fgmj';
const SAGE1 = 'prometheus_job_sage1_patches_multiignition.fgmj';

const ALBERS =
  '+proj=aea +lat_0=40 +lon_0=-96 +lat_1=50 +lat_2=70 +datum=NAD83 +units=m +no_defs';

const resolved = async (file: string, index = 0) =>
  resolveProjection(planFgmjImport(fixture(file))[index], ALBERS);

const ring = (points: Array<[number, number]>, isHole = false) => ({
  isHole,
  points: points.map(([lon, lat]) => ({ lon, lat })),
});

/** Replace an ignition's rings — the seam for the polyset cases no file has. */
function withRings(
  plan: ScenarioImportPlan,
  rings: ReturnType<typeof ring>[],
  polyType = 'POLYGON_OUT',
): ScenarioImportPlan {
  const ignition = { ...plan.ignitions[0], polyType, latLonRings: rings };
  return { ...plan, ignitions: [ignition, ...plan.ignitions.slice(1)] };
}

const OUTER: Array<[number, number]> = [
  [-116, 60],
  [-115, 60],
  [-115, 61],
  [-116, 61],
];
const HOLE: Array<[number, number]> = [
  [-115.8, 60.2],
  [-115.6, 60.2],
  [-115.6, 60.4],
  [-115.8, 60.4],
];

describe('toIgnitionGeometries', () => {
  describe('a polygon perimeter becomes a polygon', () => {
    it('produces a Polygon, not a point', async () => {
      const geometries = toIgnitionGeometries(await resolved(THREE));

      expect(geometries).toHaveLength(1);
      expect(geometries[0].geometry.type).toBe(GeometryType.Polygon);
    });

    it('keeps every vertex, and closes the ring', async () => {
      const plan = await resolved(THREE);
      const [first] = toIgnitionGeometries(plan);
      const rings = first.geometry.coordinates as number[][][];

      expect(plan.ignitions[0].rings[0].points).toHaveLength(381);
      expect(rings[0].length).toBeGreaterThanOrEqual(381);
      expect(rings[0][0]).toEqual(rings[0][rings[0].length - 1]);
    });

    it('is in lon,lat order like every other geometry here', async () => {
      const [first] = toIgnitionGeometries(await resolved(THREE));
      const [lon, lat] = (first.geometry.coordinates as number[][][])[0][0];

      expect(lon).toBeCloseTo(-116.7706, 3);
      expect(lat).toBeCloseTo(60.2698, 3);
    });
  });

  describe('holes survive', () => {
    it('emits the exterior ring first and the hole after it', async () => {
      const plan = withRings(await resolved(THREE), [ring(OUTER), ring(HOLE, true)]);

      const rings = toIgnitionGeometries(plan)[0].geometry.coordinates as number[][][];

      expect(rings).toHaveLength(2);
      expect(rings[0][0]).toEqual([-116, 60]);
      expect(rings[1][0]).toEqual([-115.8, 60.2]);
    });

    it('closes the hole ring too', async () => {
      const plan = withRings(await resolved(THREE), [ring(OUTER), ring(HOLE, true)]);

      const rings = toIgnitionGeometries(plan)[0].geometry.coordinates as number[][][];

      expect(rings[1][0]).toEqual(rings[1][rings[1].length - 1]);
    });

    it('does not quietly drop a hole', async () => {
      // The whole point: one ring out would burn the island.
      const plan = withRings(await resolved(THREE), [ring(OUTER), ring(HOLE, true)]);

      const rings = toIgnitionGeometries(plan)[0].geometry.coordinates as number[][][];

      expect(rings.length).toBe(2);
    });
  });

  describe('a point stays a point, and nothing is dropped', () => {
    it('keeps both of sage1’s ignitions, with their own shapes', async () => {
      const geometries = toIgnitionGeometries(await resolved(SAGE1));

      expect(geometries.map((g) => g.name)).toEqual(['ign5', 'Ignition 2 point']);
      expect(geometries.map((g) => g.geometry.type)).toEqual([
        GeometryType.Polygon,
        GeometryType.Point,
      ]);
    });
  });

  describe('it refuses to run ahead of the CRS', () => {
    it('throws while the coordinates are still projected', () => {
      const [best] = planFgmjImport(fixture(THREE));

      expect(() => toIgnitionGeometries(best)).toThrow(/projected|CRS|lat/i);
    });
  });

  describe('shapes needing more than a mapping', () => {
    it('records POLYGON_IN as a divergence — it burns inward', async () => {
      const plan = withRings(await resolved(THREE), [ring(OUTER)], 'POLYGON_IN');

      const [geometry] = toIgnitionGeometries(plan);

      expect(geometry.geometry.type).toBe(GeometryType.Polygon);
      expect(geometry.divergence).toMatch(/inward/i);
    });

    it('records nothing for an ordinary outward polygon', async () => {
      expect(toIgnitionGeometries(await resolved(THREE))[0].divergence).toBeUndefined();
    });

    it('maps LINE to a LineString', async () => {
      const plan = withRings(await resolved(THREE), [ring(OUTER)], 'LINE');

      expect(toIgnitionGeometries(plan)[0].geometry.type).toBe(GeometryType.LineString);
    });

    it('refuses a shape the file never stated', async () => {
      const plan = withRings(await resolved(THREE), [ring(OUTER)], 'UNKNOWN');

      expect(() => toIgnitionGeometries(plan)).toThrow(/UNKNOWN|shape/i);
    });

    it('refuses a shape the schema does not define', async () => {
      const plan = withRings(await resolved(THREE), [ring(OUTER)], 'BANANA');

      expect(() => toIgnitionGeometries(plan)).toThrow(/BANANA/);
    });

    it('refuses holes on a shape that cannot have them', async () => {
      const plan = withRings(await resolved(THREE), [ring(OUTER), ring(HOLE, true)], 'LINE');

      expect(() => toIgnitionGeometries(plan)).toThrow(/hole|LINE/i);
    });
  });
});
