/**
 * toExecutionOptions wiring for merged ignitions (refs #294 slice 4).
 *
 * toExecutionOptions used to THROW for more than one ignition ("merging
 * them is not implemented yet"). This replaces that refusal with the real
 * merge — built from the real LWF-184 fixture plus one synthetic second
 * ignition, since no runnable real-world fixture has more than one
 * ignition (the one that does, sage1, is permanently blocked on
 * `polygonWeatherPatch` as well as `crs` — see mergeIgnitions.test.ts for
 * the merge proven directly on that fixture's own data).
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { planFgmjImport, type ScenarioImportPlan } from '../planFgmjImport.js';
import { toExecutionOptions } from '../toExecutionOptions.js';
import { GeometryType } from '../../../domain/entities/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA = path.resolve(__dirname, '..', '..', '..', '..', '..', 'test-data');
const fixture = (...p: string[]) => path.join(TEST_DATA, ...p);

/** The real LWF-184 fixture, with one more POINT ignition appended. */
function lwf184WithSecondIgnition(): ScenarioImportPlan {
  const [plan] = planFgmjImport(fixture('wise_job_LWF-184-2021', 'job.fgmj'));
  if (!plan.runnable) {
    throw new Error(`fixture precondition failed: not runnable (${plan.blockers.join(', ')})`);
  }
  const second = {
    ...plan.ignitions[0],
    name: 'ign5-spot',
    latLonRings: [
      { isHole: false, points: [{ lon: -112.19, lat: 55.70 }] },
    ],
  };
  return { ...plan, ignitions: [...plan.ignitions, second] };
}

describe('toExecutionOptions — merging more than one ignition', () => {
  it('no longer throws "not implemented" for two ignitions', () => {
    expect(() => toExecutionOptions(lwf184WithSecondIgnition())).not.toThrow(/not implemented/i);
  });

  it('produces a MultiPolygon ignition geometry with one member per ignition', () => {
    const { options } = toExecutionOptions(lwf184WithSecondIgnition());
    expect(options.ignitionGeometry.type).toBe(GeometryType.MultiPolygon);
    const members = options.ignitionGeometry.coordinates as unknown[];
    expect(members).toHaveLength(2);
  });

  it('adds a notice naming each merged ignition and what was done to it', () => {
    const { notices } = toExecutionOptions(lwf184WithSecondIgnition());
    expect(notices.some((n) => n.includes('"ign5"'))).toBe(true);
    expect(notices.some((n) => n.includes('"ign5-spot"'))).toBe(true);
    // Both are POINTs, so both notices describe the circle conversion.
    expect(notices.filter((n) => /circle/i.test(n))).toHaveLength(2);
  });

  it('still refuses a single ignition with the old single-ignition path untouched', () => {
    // The unmerged single-ignition fixture must still produce a plain
    // Point, not a MultiPolygon it never needed.
    const [plan] = planFgmjImport(fixture('wise_job_LWF-184-2021', 'job.fgmj'));
    const { options } = toExecutionOptions(plan);
    expect(options.ignitionGeometry.type).toBe(GeometryType.Point);
  });
});
