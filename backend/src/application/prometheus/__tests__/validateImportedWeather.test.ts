/**
 * Checking imported weather against FireSTARR's actual input contract
 * (refs #294, and #339/#340/#341 which established the contract).
 *
 * FireSTARR builds its daily fire weather from NOON RECORDS ONLY — an
 * hour-12 literal in the engine, not a setting. A day inside the simulated
 * window with no hour-12 row never gets a daily entry, and the later lookup
 * dies with `FATAL: map::at` about ten seconds in, with the reason visible only
 * in the container log. Four of six runs on the CIFFC demo died exactly that
 * way.
 *
 * An imported .fgmj can easily produce such a stream — its weather starts
 * wherever the original author's did, and the scenario window starts wherever
 * they put the ignition. Catching it here means the operator is told what is
 * wrong while they can still fix it, rather than watching a job die for reasons
 * they cannot see.
 *
 * The zone used for day-bucketing is the file's OWN UTC offset, not a guessed
 * IANA name. The fgmj records -06:00 explicitly; inventing "America/Edmonton"
 * to go with it would be a guess, and for deciding which local day an hour
 * falls in, the offset the file carried is the authority.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { planFgmjImport } from '../planFgmjImport.js';
import { validateImportedWeather } from '../validateImportedWeather.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA = path.resolve(__dirname, '..', '..', '..', '..', '..', 'test-data');
const fixture = (n: string) => path.join(TEST_DATA, n);
const THREE = 'prometheus_job_SS008-25_3scenarios.fgmj';

describe('validateImportedWeather', () => {
  describe('the real corpus', () => {
    it('passes every scenario of every fixture', () => {
      for (const f of [
        THREE,
        'prometheus_job_sage1_patches_multiignition.fgmj',
        'prometheus_job_sage2_polygon_winddirection.fgmj',
        'prometheus_job_sage3_divide_compass.fgmj',
      ]) {
        for (const plan of planFgmjImport(fixture(f))) {
          expect(validateImportedWeather(plan), `${f} / ${plan.scenarioName}`).toEqual([]);
        }
      }
    });

    it('adds no weatherContract blocker to a valid plan', () => {
      for (const plan of planFgmjImport(fixture(THREE))) {
        expect(plan.blockers).not.toContain('weatherContract');
      }
    });
  });

  describe('a day in the window with no noon record', () => {
    it('is refused, naming the day', () => {
      const [best] = planFgmjImport(fixture(THREE));
      // The window is 13:00 on the 26th to 13:00 on the 27th, so both days are
      // simulated. Drop the 27th's noon row.
      const weather = best.weather.filter(
        (row) => !(row.date.getUTCHours() === 18 && row.date.getUTCDate() === 27),
      );
      expect(weather.length).toBeLessThan(best.weather.length);

      const issues = validateImportedWeather({ ...best, weather });

      expect(issues.length).toBeGreaterThan(0);
      expect(issues.join(' ')).toMatch(/2025-06-27/);
    });

    it('explains the consequence rather than only the rule', () => {
      const [best] = planFgmjImport(fixture(THREE));
      const weather = best.weather.filter(
        (row) => !(row.date.getUTCHours() === 18 && row.date.getUTCDate() === 27),
      );

      const issues = validateImportedWeather({ ...best, weather });

      expect(issues.join(' ')).toMatch(/noon|12:00/i);
    });
  });

  describe('trailing hours past the end of the run are not a problem', () => {
    it('ignores a stub day after the window closes', () => {
      // The stream runs to 2025-07-06 while the window ends on the 27th. The
      // final day carries a single 00:00 row and no noon, and the simulation
      // never reaches it. Requiring noon there once rejected a known-good file.
      const [best] = planFgmjImport(fixture(THREE));

      expect(best.durationHours).toBe(24);
      expect(validateImportedWeather(best)).toEqual([]);
    });
  });

  describe('an empty stream', () => {
    it('is refused rather than passing vacuously', () => {
      const [best] = planFgmjImport(fixture(THREE));

      const issues = validateImportedWeather({ ...best, weather: [] });

      expect(issues.length).toBeGreaterThan(0);
    });
  });

  describe('the window, not the whole file, is what is checked', () => {
    it('does not complain about days before the ignition', () => {
      // The 3 Day scenario starts on the 26th like the others, but the stream
      // begins at 00:00 that day — hours before the window opens.
      const plans = planFgmjImport(fixture(THREE));
      const threeDay = plans[2];

      expect(threeDay.durationHours).toBe(72);
      expect(validateImportedWeather(threeDay)).toEqual([]);
    });
  });
});
