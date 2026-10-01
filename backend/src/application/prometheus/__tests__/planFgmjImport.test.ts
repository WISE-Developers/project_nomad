/**
 * Planning an import: what this file would produce, and what stands in the way
 * (refs #294).
 *
 * This composes the pieces — parse, resolve, patch, ignitions, weather — into
 * one answer per scenario. It deliberately produces a PLAN rather than a
 * FireSTARR model, because the sample files cannot yet produce one and saying
 * so plainly is the point:
 *
 *   FireSTARRParams requires latitude/longitude in WGS84. Every sample is in
 *   projected metres, and the CRS is not in the file. Until the operator
 *   supplies one there is no lat/lon to give, and inventing it would put the
 *   fire hundreds of kilometres away.
 *
 * So a plan carries blockers. An operator pointing Nomad at a directory of old
 * job files learns what each one needs before anything runs, which is more
 * useful than a half-built model and far better than a plausible wrong one.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { planFgmjImport } from '../planFgmjImport.js';
import { loadFgmjProject } from '../loadFgmjProject.js';
import { resolveScenarios } from '../resolveScenarios.js';
import { extractWeatherStream } from '../extractWeatherStream.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA = path.resolve(__dirname, '..', '..', '..', '..', '..', 'test-data');
const fixture = (n: string) => path.join(TEST_DATA, n);
const THREE = 'prometheus_job_SS008-25_3scenarios.fgmj';

describe('planFgmjImport', () => {
  describe('one plan per scenario', () => {
    it('plans all three scenarios of a three-scenario file', () => {
      const plans = planFgmjImport(fixture(THREE));

      expect(plans).toHaveLength(3);
      expect(plans.map((p) => p.scenarioName)).toEqual([
        'SS008-25 BEST Case Scenario',
        'SS008-25 WORST Case Scenario',
        'SS008-25 3 Day Scenario',
      ]);
    });

    it('carries each scenario’s own window and duration', () => {
      const plans = planFgmjImport(fixture(THREE));

      expect(plans.map((p) => p.durationHours)).toEqual([24, 24, 72]);
      expect(plans[0].startTime).toBe('2025-06-26T13:00:00-06:00');
    });

    it('carries the ignitions and the starting codes', () => {
      const [best] = planFgmjImport(fixture(THREE));

      expect(best.ignitions).toHaveLength(1);
      expect(best.ignitions[0].polyType).toBe('POLYGON_OUT');
      expect(best.startingCodes.ffmc).toBeCloseTo(87, 6);
    });
  });

  describe('the scenario’s own patches are applied to its own weather', () => {
    const rawRows = () => {
      const [best] = resolveScenarios(loadFgmjProject(fixture(THREE)));
      return extractWeatherStream(best, TEST_DATA).rows;
    };

    it('raises RH by five points inside the BEST patch window', () => {
      const raw = rawRows();
      const [best] = planFgmjImport(fixture(THREE));

      // The patch runs 13:00 on the 26th to 13:00 on the 27th; the stream
      // starts at 00:00 on the 26th, so row 13 is the first hour inside it.
      expect(best.weather[13].rh).toBeCloseTo(raw[13].rh + 5, 4);
      expect(best.weather[13].temp).toBeCloseTo(raw[13].temp - 5, 4);
    });

    it('lowers RH by five points for WORST — the inverse patch', () => {
      const raw = rawRows();
      const plans = planFgmjImport(fixture(THREE));

      expect(plans[1].weather[13].rh).toBeCloseTo(raw[13].rh - 5, 4);
      expect(plans[1].weather[13].temp).toBeCloseTo(raw[13].temp + 5, 4);
    });

    it('leaves the unpatched scenario’s weather alone', () => {
      const raw = rawRows();
      const plans = planFgmjImport(fixture(THREE));

      // The 3 Day scenario names no filter, though the file declares two.
      expect(plans[2].appliedPatches).toEqual([]);
      expect(plans[2].weather[13].rh).toBeCloseTo(raw[13].rh, 6);
      expect(plans[2].weather[13].temp).toBeCloseTo(raw[13].temp, 6);
    });

    it('records which patches it applied', () => {
      const plans = planFgmjImport(fixture(THREE));

      expect(plans[0].appliedPatches).toEqual(['wthrptch10']);
      expect(plans[1].appliedPatches).toEqual(['wthrptch11']);
    });

    it('leaves rows outside the patch window untouched', () => {
      const raw = rawRows();
      const [best] = planFgmjImport(fixture(THREE));

      // Row 0 is 00:00 on the 26th, before the patch starts.
      expect(best.weather[0].rh).toBeCloseTo(raw[0].rh, 6);
    });
  });

  describe('blockers are stated, not worked around', () => {
    it('reports that a projected file needs a CRS before it can run', () => {
      const plans = planFgmjImport(fixture(THREE));

      for (const plan of plans) {
        expect(plan.blockers).toContain('crs');
        expect(plan.runnable).toBe(false);
      }
    });

    it('names the blocker in terms an operator can act on', () => {
      const [best] = planFgmjImport(fixture(THREE));

      expect(best.blockerDetail.join(' ')).toMatch(/projected/i);
      expect(best.blockerDetail.join(' ')).toMatch(/CRS|coordinate reference/i);
    });

    it('offers no latitude or longitude it could not have computed', () => {
      const [best] = planFgmjImport(fixture(THREE));

      expect(best.latitude).toBeUndefined();
      expect(best.longitude).toBeUndefined();
    });
  });

  describe('every fixture plans without throwing', () => {
    it('plans the whole corpus', () => {
      for (const f of [
        THREE,
        'prometheus_job_sage1_patches_multiignition.fgmj',
        'prometheus_job_sage2_polygon_winddirection.fgmj',
        'prometheus_job_sage3_divide_compass.fgmj',
      ]) {
        const plans = planFgmjImport(fixture(f));
        expect(plans.length, f).toBeGreaterThan(0);
        for (const plan of plans) {
          expect(plan.weather.length, `${f} / ${plan.scenarioName}`).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('filter kinds are honoured, not lumped together', () => {
    const SAGE1 = 'prometheus_job_sage1_patches_multiignition.fgmj';

    it('applies the landscape weather patch and nothing else', () => {
      const [best] = planFgmjImport(fixture(SAGE1));

      // The scenario names three filters of three different kinds.
      expect(best.appliedPatches).toEqual(['wthrptch10 augmented for Sage']);
    });

    it('notifies about a fuel patch and does not apply it', () => {
      const [best] = planFgmjImport(fixture(SAGE1));

      expect(best.skippedFuelPatches).toEqual(['all fuel to c2']);
      expect(best.warnings.join(' ')).toMatch(/all fuel to c2/);
      expect(best.warnings.join(' ')).toMatch(/fuel/i);
    });

    it('treats both fuel-patch kinds the same way', () => {
      // polyReplace and replace are both fuel patches.
      const plans = planFgmjImport(fixture(SAGE1));
      const threeDay = plans[2];

      expect(threeDay.skippedFuelPatches).toEqual(['all fuel to c2', 'Landscape Fuel Patch ']);
    });

    it('blocks on a polygon weather patch instead of applying it globally', () => {
      const [best] = planFgmjImport(fixture(SAGE1));

      expect(best.polygonPatches).toEqual(['Weather Poly Patch for Sage']);
      expect(best.blockers).toContain('polygonWeatherPatch');
      expect(best.blockerDetail.join(' ')).toMatch(/polygon/i);
      expect(best.blockerDetail.join(' ')).toMatch(/global|ignore/i);
    });

    it('does not let a skipped patch alter the weather', () => {
      const plans = planFgmjImport(fixture(SAGE1));
      const threeDay = plans[2];

      // Only wthrptch11 applied: RH down five, temperature up five.
      expect(threeDay.appliedPatches).toEqual(['wthrptch11']);
    });
  });
});
