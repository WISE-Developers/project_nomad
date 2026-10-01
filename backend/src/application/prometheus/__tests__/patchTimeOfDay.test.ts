/**
 * The time-of-day window on a weather patch (refs #294).
 *
 * A patch has an absolute window (startTime..endTime) and ALSO
 * startTimeOfDay/endTimeOfDay, which are `HSS.Times.WTimeSpan` — durations from
 * midnight, not clock times. They restrict which hours of each day the patch
 * touches, so ignoring them would apply a patch to hours it was meant to spare.
 * It was refused outright, which blocked 15 real files.
 *
 * WHAT THE CORPUS ACTUALLY CONTAINS, across 78 occurrences in 43 files:
 *
 *   68  "13:00:00:00" -> "13:00:00:00"     start == end
 *    7  "13:00:00"    -> "13:00:00"        start == end
 *    2  "00:36:43"    -> "12:36:43"        a real 12-hour daily window
 *    1  absent (= 0)  -> "13:00:00"        a real 00:00->13:00 window
 *
 * So 75 of 78 have start == end: the daily window is the whole cycle and adds
 * no constraint. 41 files are in that case and only 2 carry a differing pair.
 *
 * The format is settled by the corpus itself: 7 files write "13:00:00" where 68
 * write "13:00:00:00" for the same thing, so the leading field is HOURS, not
 * days, and any fourth field is below seconds.
 *
 * THE LIMIT, and it is not a choice: both differing files write their scenario
 * times in UTC and keep the real zone in `timeZoneSettings.timezoneIndex`
 * (131084 — seen elsewhere alongside "MDT"). A time-of-day window cannot be
 * placed without that zone, and the index is a WISE-internal id this importer
 * cannot decode, so those are refused with the reason named.
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
const THREE = 'prometheus_job_SS008-25_3scenarios.fgmj';

/** The WORST patch: temperature Plus 5, rh Minus 0.05. Window 06-26 13:00 -> 06-27 13:00. */
const worstPatch = () =>
  resolveScenarios(loadFgmjProject(path.join(TEST_DATA, THREE)))[1].weatherFilters[0];

function withTimeOfDay(start: string | undefined, end: string | undefined) {
  const patch = worstPatch();
  const filter = patch.filter as Record<string, unknown>;
  if (start === undefined) delete filter.startTimeOfDay;
  else filter.startTimeOfDay = { time: start };
  if (end === undefined) delete filter.endTimeOfDay;
  else filter.endTimeOfDay = { time: end };
  return patch;
}

/** An hour inside the absolute window, at the given LOCAL hour (offset -06:00). */
function rowAtLocalHour(hour: number, day = 26): WeatherHourlyData {
  const hh = String(hour).padStart(2, '0');
  return {
    date: new Date(`2025-06-${day}T${hh}:00:00-06:00`),
    temp: 20,
    rh: 50,
    ws: 10,
    wd: 180,
    precip: 0,
    ffmc: 90,
    dmc: 30,
    dc: 200,
    isi: 5,
    bui: 40,
    fwi: 10,
  } as WeatherHourlyData;
}

describe('patch time-of-day window', () => {
  describe('start == end means the whole cycle, so no constraint', () => {
    it('applies the patch, where it used to be refused', () => {
      const { rows } = applyWeatherPatch(
        [rowAtLocalHour(18)],
        withTimeOfDay('13:00:00:00', '13:00:00:00'),
      );

      expect(rows[0].temp).toBeCloseTo(25, 6);
      expect(rows[0].rh).toBeCloseTo(45, 6);
    });

    it('accepts the three-field spelling too', () => {
      const { rows } = applyWeatherPatch(
        [rowAtLocalHour(18)],
        withTimeOfDay('13:00:00', '13:00:00'),
      );

      expect(rows[0].temp).toBeCloseTo(25, 6);
    });

    it('applies at every hour of the day, not just after 13:00', () => {
      const early = applyWeatherPatch(
        [rowAtLocalHour(14)],
        withTimeOfDay('13:00:00:00', '13:00:00:00'),
      );
      const late = applyWeatherPatch(
        [rowAtLocalHour(23)],
        withTimeOfDay('13:00:00:00', '13:00:00:00'),
      );

      expect(early.rows[0].temp).toBeCloseTo(25, 6);
      expect(late.rows[0].temp).toBeCloseTo(25, 6);
    });
  });

  describe('a real window constrains which hours are touched', () => {
    it('patches an hour inside 14:00-18:00 and leaves one outside alone', () => {
      const patch = () => withTimeOfDay('14:00:00', '18:00:00');

      const inside = applyWeatherPatch([rowAtLocalHour(16)], patch());
      const outside = applyWeatherPatch([rowAtLocalHour(20)], patch());

      expect(inside.rows[0].temp).toBeCloseTo(25, 6);
      expect(outside.rows[0].temp).toBeCloseTo(20, 6);
    });

    it('reads minutes and seconds, not only hours', () => {
      // 00:36:43 -> 12:36:43, the real pair from the corpus.
      const patch = () => withTimeOfDay('00:36:43', '12:36:43');

      // 06:00 local on the 27th is inside; 18:00 is not.
      const inside = applyWeatherPatch([rowAtLocalHour(6, 27)], patch());
      const outside = applyWeatherPatch([rowAtLocalHour(18)], patch());

      expect(inside.rows[0].temp).toBeCloseTo(25, 6);
      expect(outside.rows[0].temp).toBeCloseTo(20, 6);
    });

    it('treats an absent start as midnight', () => {
      // The real case: absent -> "13:00:00".
      const patch = () => withTimeOfDay(undefined, '13:00:00');

      const inside = applyWeatherPatch([rowAtLocalHour(6, 27)], patch());
      const outside = applyWeatherPatch([rowAtLocalHour(18)], patch());

      expect(inside.rows[0].temp).toBeCloseTo(25, 6);
      expect(outside.rows[0].temp).toBeCloseTo(20, 6);
    });

    it('handles a window that wraps past midnight', () => {
      const patch = () => withTimeOfDay('22:00:00', '04:00:00');

      const insideLate = applyWeatherPatch([rowAtLocalHour(23)], patch());
      const insideEarly = applyWeatherPatch([rowAtLocalHour(2, 27)], patch());
      const outside = applyWeatherPatch([rowAtLocalHour(14)], patch());

      expect(insideLate.rows[0].temp).toBeCloseTo(25, 6);
      expect(insideEarly.rows[0].temp).toBeCloseTo(25, 6);
      expect(outside.rows[0].temp).toBeCloseTo(20, 6);
    });

    it('still respects the absolute window', () => {
      // 16:00 on the 28th is inside the daily window but past endTime.
      const { rows } = applyWeatherPatch(
        [rowAtLocalHour(16, 28)],
        withTimeOfDay('14:00:00', '18:00:00'),
      );

      expect(rows[0].temp).toBeCloseTo(20, 6);
    });
  });

  describe('stop and alert', () => {
    it('refuses a real window when the patch time carries no offset', () => {
      // Both differing files in the corpus write UTC scenario times and hide
      // the zone in timeZoneSettings.timezoneIndex, which is not decodable here.
      const patch = withTimeOfDay('00:36:43', '12:36:43');
      const filter = patch.filter as Record<string, unknown>;
      filter.startTime = { time: '2024-11-14T07:36:43.313Z' };
      filter.endTime = { time: '2024-11-14T19:36:43.313Z' };

      expect(() => applyWeatherPatch([rowAtLocalHour(6)], patch)).toThrow(
        /time-of-day|zone|offset/i,
      );
    });

    it('refuses a span it cannot parse', () => {
      expect(() =>
        applyWeatherPatch([rowAtLocalHour(16)], withTimeOfDay('half past two', '18:00:00')),
      ).toThrow(/half past two/);
    });
  });
});
