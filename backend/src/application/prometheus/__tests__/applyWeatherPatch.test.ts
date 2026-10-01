/**
 * Applying Prometheus weather patches to a FireSTARR weather stream (refs #294).
 *
 * THE ×100 TRAP, which this file exists for.
 *
 * fgmj stores RH as a FRACTION. WISE_JS_API's setValuePercent is
 * `this.value = value / 100.0`, so the file holding `rh: {value: 0.05}` means
 * five percentage points. FireSTARR's weather CSV stores RH as a PERCENTAGE —
 * real rows read `RH` 56, 57 — and WeatherHourlyData.rh is documented 0-100.
 *
 * So the conversion is unconditionally ×100 for RH, and for RH alone.
 * Temperature, wind speed and precipitation are already in the units the CSV
 * uses and must NOT be scaled. Getting either wrong leaves a run that completes
 * and looks entirely plausible and is out by two orders of magnitude.
 *
 * The patches here are the real ones from the fixture, not invented: the file
 * declares an inverse pair, a BEST case (cooler and wetter) and a WORST case
 * (hotter and drier), which is what makes the direction of each operation
 * checkable rather than merely self-consistent.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadFgmjProject } from '../loadFgmjProject.js';
import { resolveScenarios } from '../resolveScenarios.js';
import { applyWeatherPatch } from '../applyWeatherPatch.js';
import type { WeatherHourlyData } from '../../../infrastructure/firestarr/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA = path.resolve(__dirname, '..', '..', '..', '..', '..', 'test-data');

const scenarios = () =>
  resolveScenarios(
    loadFgmjProject(path.join(TEST_DATA, 'prometheus_job_SS008-25_3scenarios.fgmj')),
  );

const bestPatch = () => scenarios()[0].weatherFilters[0];
const worstPatch = () => scenarios()[1].weatherFilters[0];

/** One hour inside the patch window (2025-06-26T13:00-06:00 .. 06-27T13:00-06:00). */
function rowInWindow(over: Partial<WeatherHourlyData> = {}): WeatherHourlyData {
  return {
    date: new Date('2025-06-26T18:00:00-06:00'),
    temp: 17.09,
    rh: 56,
    ws: 7.16,
    wd: 134,
    precip: 0,
    ffmc: 90,
    dmc: 30,
    dc: 200,
    isi: 5,
    bui: 40,
    fwi: 10,
    ...over,
  } as WeatherHourlyData;
}

/** One hour after the window closes. */
function rowOutsideWindow(): WeatherHourlyData {
  return rowInWindow({ date: new Date('2025-06-28T18:00:00-06:00') });
}

describe('applyWeatherPatch', () => {
  describe('RH is a fraction in the file and a percentage in the CSV', () => {
    it('reads rh 0.05 Minus as five percentage points, not 0.05', () => {
      const { rows: [patched] } = applyWeatherPatch([rowInWindow()], worstPatch());

      expect(patched.rh).toBeCloseTo(51, 6);
      // the bug this test exists to catch
      expect(patched.rh).not.toBeCloseTo(55.95, 6);
    });

    it('reads rh 0.05 Plus as five percentage points upward', () => {
      const { rows: [patched] } = applyWeatherPatch([rowInWindow()], bestPatch());

      expect(patched.rh).toBeCloseTo(61, 6);
      expect(patched.rh).not.toBeCloseTo(56.05, 6);
    });
  });

  describe('every other variable is already in the CSV’s units', () => {
    it('applies temperature directly, without the ×100', () => {
      const { rows: [worse] } = applyWeatherPatch([rowInWindow()], worstPatch());
      const { rows: [better] } = applyWeatherPatch([rowInWindow()], bestPatch());

      expect(worse.temp).toBeCloseTo(22.09, 6); // Plus 5
      expect(better.temp).toBeCloseTo(12.09, 6); // Minus 5
    });

    it('leaves variables the patch does not mention alone', () => {
      const original = rowInWindow();
      const { rows: [patched] } = applyWeatherPatch([original], worstPatch());

      expect(patched.ws).toBe(original.ws);
      expect(patched.wd).toBe(original.wd);
      expect(patched.precip).toBe(original.precip);
    });
  });

  describe('the BEST and WORST patches are exact inverses', () => {
    it('moves temperature and humidity in opposite directions', () => {
      const base = rowInWindow();
      const { rows: [worse] } = applyWeatherPatch([base], worstPatch());
      const { rows: [better] } = applyWeatherPatch([base], bestPatch());

      expect(worse.temp - base.temp).toBeCloseTo(-(better.temp - base.temp), 6);
      expect(worse.rh - base.rh).toBeCloseTo(-(better.rh - base.rh), 6);
      // hotter and drier vs cooler and wetter
      expect(worse.temp).toBeGreaterThan(better.temp);
      expect(worse.rh).toBeLessThan(better.rh);
    });
  });

  describe('the patch applies only within its own window', () => {
    it('leaves rows outside the window untouched', () => {
      const outside = rowOutsideWindow();
      const { rows: [patched] } = applyWeatherPatch([outside], worstPatch());

      expect(patched.temp).toBe(outside.temp);
      expect(patched.rh).toBe(outside.rh);
    });

    it('patches only the rows inside, in a mixed stream', () => {
      const inside = rowInWindow();
      const outside = rowOutsideWindow();
      const { rows: [a, b] } = applyWeatherPatch([inside, outside], worstPatch());

      expect(a.rh).toBeCloseTo(51, 6);
      expect(b.rh).toBe(outside.rh);
    });
  });

  describe('it does not mutate its input', () => {
    it('returns new rows and leaves the originals as they were', () => {
      const original = rowInWindow();
      const before = { ...original };
      applyWeatherPatch([original], worstPatch());

      expect(original.rh).toBe(before.rh);
      expect(original.temp).toBe(before.temp);
    });
  });

  describe('RH is clamped to 0-100, and says so', () => {
    it('clamps an overshoot at 100 rather than emitting 103', () => {
      // BEST adds five percentage points; 98 + 5 is not a humidity.
      const { rows, warnings } = applyWeatherPatch([rowInWindow({ rh: 98 })], bestPatch());

      expect(rows[0].rh).toBe(100);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/wthrptch10/);
      expect(warnings[0]).toMatch(/103/);
      expect(warnings[0]).toMatch(/100/);
    });

    it('clamps an undershoot at 0', () => {
      // WORST subtracts five; 3 - 5 is not a humidity either.
      const { rows, warnings } = applyWeatherPatch([rowInWindow({ rh: 3 })], worstPatch());

      expect(rows[0].rh).toBe(0);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/wthrptch11/);
    });

    it('says nothing when every value stays in range', () => {
      const { warnings } = applyWeatherPatch([rowInWindow()], worstPatch());

      expect(warnings).toEqual([]);
    });

    it('warns once per affected row, naming the row time', () => {
      const rows = [
        rowInWindow({ rh: 99 }),
        rowInWindow({ rh: 50 }),
        rowInWindow({ rh: 97 }),
      ];
      const result = applyWeatherPatch(rows, bestPatch());

      expect(result.rows.map((r) => r.rh)).toEqual([100, 55, 100]);
      expect(result.warnings).toHaveLength(2);
      expect(result.warnings[0]).toMatch(/2025-06-26/);
    });

    it('does not clamp a row the patch never touched', () => {
      const { rows, warnings } = applyWeatherPatch(
        [{ ...rowOutsideWindow(), rh: 103 }],
        bestPatch(),
      );

      // Out of range, but not ours to change: the patch does not reach it.
      expect(rows[0].rh).toBe(103);
      expect(warnings).toEqual([]);
    });
  });
});
