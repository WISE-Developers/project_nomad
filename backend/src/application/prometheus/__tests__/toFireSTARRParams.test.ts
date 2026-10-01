/**
 * Assembling a runnable FireSTARRParams from an import plan (refs #294).
 *
 * This is the issue's central acceptance criterion. Everything before it
 * produced a PLAN — geometry, weather, blockers — but never a model. A plan
 * that cannot become a model does not let an operator re-run an old incident,
 * which is the whole reason #294 exists.
 *
 * Asserted against wise_job_LWF-184-2021, a real WISE job with real lat/lon
 * ignitions and an external weather file, because a fixture I wrote myself
 * would only prove the importer agrees with me.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { planFgmjImport } from '../planFgmjImport.js';
import { toFireSTARRParams } from '../toFireSTARRParams.js';
import { GeometryType } from '../../../domain/entities/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA = path.resolve(__dirname, '..', '..', '..', '..', '..', 'test-data');
const fixture = (...p: string[]) => path.join(TEST_DATA, ...p);

const assemble = (plan: ReturnType<typeof planFgmjImport>[number]) => toFireSTARRParams(plan);

const lwf184 = () => {
  const plans = planFgmjImport(fixture('wise_job_LWF-184-2021', 'job.fgmj'));
  const plan = plans[0];
  if (!plan.runnable) {
    throw new Error(`fixture precondition failed: plan is not runnable (${plan.blockers.join(', ')})`);
  }
  return plan;
};

describe('toFireSTARRParams — the real runnable job', () => {
  it('carries the scenario position through unchanged', () => {
    const { params } = assemble(lwf184());
    expect(params.latitude).toBe(55.678433);
    expect(params.longitude).toBe(-112.2258);
  });

  it('splits the file’s own local start into a date and a wall-clock time', () => {
    // The file says 2021-09-02T13:00:00-06:00. FireSTARR wants the wall-clock
    // time separately, in the zone it is given — NOT the UTC instant, which
    // would be 19:00 and would start the fire six hours late.
    const { params } = assemble(lwf184());
    expect(params.startTime).toBe('13:00');
    expect(params.timezone).toBe('-06:00');
    expect(params.startDate.toISOString()).toBe('2021-09-02T19:00:00.000Z');
  });

  it('passes the starting codes as the previous-day indices', () => {
    const { params } = assemble(lwf184());
    expect(params.previousFFMC).toBe(37);
    expect(params.previousDMC).toBe(2);
    expect(params.previousDC).toBe(297);
    expect(params.previousPrecip).toBeCloseTo(0.32, 5);
  });

  it('hands over every weather row the scenario resolved', () => {
    const plan = lwf184();
    const { params } = assemble(plan);
    expect(params.weatherData).toHaveLength(241);
    expect(params.weatherData).toHaveLength(plan.weather.length);
  });

  it('turns the 72-hour window into one output offset per day', () => {
    const { params } = assemble(lwf184());
    expect(params.outputDateOffsets).toEqual([1, 2, 3]);
  });

  it('builds the single ignition as its own geometry', () => {
    const { params } = assemble(lwf184());
    expect(params.ignitionGeometry).toBeDefined();
    expect(params.ignitionGeometry!.type).toBe(GeometryType.Point);
    expect(params.ignitionGeometry!.coordinates).toEqual([-112.2258, 55.678433]);
  });

  it('reports no merge notice when there is only one ignition', () => {
    const { notices } = assemble(lwf184());
    expect(notices).toEqual([]);
  });
});

describe('toFireSTARRParams — refusals', () => {
  it('refuses a plan that is not runnable rather than inventing what is missing', () => {
    const plans = planFgmjImport(fixture('prometheus_job_sage1_patches_multiignition.fgmj'));
    const blocked = plans.find((p) => !p.runnable);
    expect(blocked).toBeDefined();
    expect(() => toFireSTARRParams(blocked!)).toThrow(/not runnable|blocker/i);
  });
});

describe('toFireSTARRParams — polygon and line ignitions also become the perimeter', () => {
  /**
   * The engine does this for a wizard-built run (FireSTARREngine.buildParams:
   * `perimeter: (type === Polygon || type === LineString) ? ignition : undefined`),
   * where it is rasterized to a TIF. An imported run that skipped it would start
   * the fire from a bare centroid and lose the shape the .fgmj recorded — the
   * same class of bug as producing a lat/lon point for a 381-vertex perimeter.
   *
   * Driven through the real path: the plan's own ignition rings, so
   * toIgnitionGeometries builds the geometry exactly as it would in production.
   */
  const reshape = (polyType: string, points: { lon: number; lat: number }[]) => {
    const plan = lwf184();
    const [ignition] = plan.ignitions;
    return {
      ...plan,
      ignitions: [{
        ...ignition,
        polyType,
        rings: [{ isHole: false, points: points.map((p) => ({ x: p.lon, y: p.lat })) }],
        latLonRings: [{ isHole: false, points }],
      }],
    };
  };

  const SQUARE = [
    { lon: -112.23, lat: 55.67 },
    { lon: -112.22, lat: 55.67 },
    { lon: -112.22, lat: 55.68 },
    { lon: -112.23, lat: 55.68 },
  ];

  it('mirrors a polygon ignition into perimeter', () => {
    const { params } = toFireSTARRParams(reshape('POLYGON_OUT', SQUARE));
    expect(params.ignitionGeometry!.type).toBe(GeometryType.Polygon);
    expect(params.perimeter).toBeDefined();
    expect(params.perimeter).toBe(params.ignitionGeometry);
  });

  it('mirrors a line ignition into perimeter', () => {
    const { params } = toFireSTARRParams(reshape('LINE', SQUARE.slice(0, 2)));
    expect(params.ignitionGeometry!.type).toBe(GeometryType.LineString);
    expect(params.perimeter).toBeDefined();
    expect(params.perimeter).toBe(params.ignitionGeometry);
  });

  it('leaves perimeter unset for a point ignition', () => {
    const { params } = assemble(lwf184());
    expect(params.ignitionGeometry!.type).toBe(GeometryType.Point);
    expect(params.perimeter).toBeUndefined();
  });
});
