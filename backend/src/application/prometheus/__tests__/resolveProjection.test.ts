/**
 * Answering the projection question (refs #294).
 *
 * extractIgnitions detects that coordinates are projected and refuses to guess.
 * This is the other half: the operator supplies a CRS and the points are
 * reprojected to WGS84 with it.
 *
 * THE AXIS-ORDER TRAP, which is worth more care than the reprojection itself.
 *
 * GDAL 3 honours the authority axis order, and EPSG:4326 declares latitude
 * first. So `fromEPSG(4326)` returns x = LATITUDE and y = LONGITUDE — the
 * reverse of the x=lon convention used everywhere else here. Verified:
 *
 *   fromEPSG(4326)   x=60.2698   y=-116.7706
 *   proj4 longlat    x=-116.7706 y=60.2698
 *
 * Reading those the wrong way round produces a plausible-looking pair of
 * numbers that puts the fire in the wrong hemisphere, so the target is built
 * from an explicit proj4 longlat definition rather than from the EPSG code.
 *
 * Expected values below were computed here with gdal against the real fixture
 * coordinates, not copied from the issue.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { planFgmjImport } from '../planFgmjImport.js';
import { resolveProjection } from '../resolveProjection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA = path.resolve(__dirname, '..', '..', '..', '..', '..', 'test-data');
const fixture = (n: string) => path.join(TEST_DATA, n);
const THREE = 'prometheus_job_SS008-25_3scenarios.fgmj';

/** ESRI:102001 — Canada Albers Equal Area Conic (NAD83), the sample's real CRS. */
const ALBERS =
  '+proj=aea +lat_0=40 +lon_0=-96 +lat_1=50 +lat_2=70 +datum=NAD83 +units=m +no_defs';

import { withoutProjection } from './fixtures/withoutProjection.js';
describe('resolveProjection', () => {
  describe('with the CRS the operator supplies', () => {
    it('reprojects the ignition to WGS84', async () => {
      const [best] = planFgmjImport(fixture(THREE));
      const resolved = await resolveProjection(best, ALBERS);

      // -1114437.36, 2423419.05 in Albers -> NWT, near Hay River.
      expect(resolved.longitude).toBeCloseTo(-116.7706, 3);
      expect(resolved.latitude).toBeCloseTo(60.2698, 3);
    });

    it('puts longitude and latitude the right way round', async () => {
      const [best] = planFgmjImport(fixture(THREE));
      const resolved = await resolveProjection(best, ALBERS);

      // The trap: fromEPSG(4326) would give these swapped, and -116 is not a
      // latitude. Assert the ranges, not just the values.
      expect(Math.abs(resolved.latitude!)).toBeLessThanOrEqual(90);
      expect(resolved.longitude!).toBeLessThan(-90);
      expect(resolved.latitude!).toBeGreaterThan(0);
    });

    it('clears the crs blocker it answered', async () => {
      // Fed from a plan with no projection of its own: SS008-25 states its CRS
      // and is resolved during planning now, so it carries no blocker to clear.
      // The operator path still matters for the files that state nothing.
      const [best] = withoutProjection((p) => planFgmjImport(p));
      expect(best.blockers).toContain('crs');

      const resolved = await resolveProjection(best, ALBERS);

      expect(resolved.blockers).not.toContain('crs');
      expect(resolved.blockerDetail.join(' ')).not.toMatch(/coordinate reference/i);
    });

    it('records the CRS it was given, so the answer is traceable', async () => {
      // Same: the recorded CRS must be the one the OPERATOR gave, which only
      // happens on a plan that did not already answer the question itself.
      const [best] = withoutProjection((p) => planFgmjImport(p));
      const resolved = await resolveProjection(best, ALBERS);

      expect(resolved.ignitions[0].crs).toBe(ALBERS);
      expect(resolved.ignitions[0].requiresCrs).toBe(false);
      expect(resolved.ignitions[0].coordinateSystem).toBe('latLon');
    });

    it('reprojects every point, not only the first', async () => {
      const [best] = planFgmjImport(fixture(THREE));
      const resolved = await resolveProjection(best, ALBERS);
      const points = resolved.ignitions[0].latLonRings![0].points;

      expect(points.length).toBe(resolved.ignitions[0].rings[0].points.length);
      for (const p of points) {
        expect(Math.abs(p.lat)).toBeLessThanOrEqual(90);
        expect(Math.abs(p.lon)).toBeLessThanOrEqual(180);
      }
    });

    it('reprojects a second ignition independently', async () => {
      const [best] = planFgmjImport(fixture('prometheus_job_sage1_patches_multiignition.fgmj'));
      const resolved = await resolveProjection(best, ALBERS);

      // -1144969.05, 2425832.17 -> the second ignition, west of the first.
      const second = resolved.ignitions[1].latLonRings![0].points[0];
      expect(second.lon).toBeCloseTo(-117.3165, 3);
      expect(second.lat).toBeCloseTo(60.2069, 3);
    });
  });

  describe('other blockers are not swept up', () => {
    it('leaves a polygon-patch blocker in place', async () => {
      const [best] = planFgmjImport(fixture('prometheus_job_sage1_patches_multiignition.fgmj'));
      expect(best.blockers).toContain('polygonWeatherPatch');

      const resolved = await resolveProjection(best, ALBERS);

      expect(resolved.blockers).toContain('polygonWeatherPatch');
      expect(resolved.runnable).toBe(false);
    });
  });

  describe('stop and alert', () => {
    it('refuses a CRS it cannot build', async () => {
      const [best] = planFgmjImport(fixture(THREE));

      await expect(resolveProjection(best, 'not-a-crs')).rejects.toThrow(/not-a-crs/);
    });

    it('refuses an empty CRS rather than treating it as none', async () => {
      const [best] = planFgmjImport(fixture(THREE));

      await expect(resolveProjection(best, '   ')).rejects.toThrow();
    });
  });

  describe('a plan that never needed a CRS', () => {
    it('is returned unchanged rather than transformed twice', async () => {
      const [best] = planFgmjImport(fixture(THREE));
      const once = await resolveProjection(best, ALBERS);
      const twice = await resolveProjection(once, ALBERS);

      expect(twice.longitude).toBeCloseTo(once.longitude!, 9);
      expect(twice.latitude).toBeCloseTo(once.latitude!, 9);
    });
  });
});
