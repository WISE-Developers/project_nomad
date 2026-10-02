/**
 * Turning a WISE weather stream into hourly observations (refs #294).
 *
 * Three things here are easy to get wrong and quiet when you do.
 *
 * 1. RH IN THE STREAM IS ALREADY A PERCENTAGE — 91.0, 88.0 — while a weather
 *    PATCH stores it as a fraction. The ×100 belongs to the patch operand and
 *    nowhere else. Applying it here too would be the same 100× error from the
 *    other end.
 *
 * 2. A ZERO SCALAR HAS NO `value`. proto3 omits default values, so an hour with
 *    no rain decodes as `precip: {hex: {value: "0x0.0000000000000p+0"}}` — the
 *    message is there, its `value` is not. "Message present, value absent"
 *    means zero. "Message absent" means the file never said, which is an error.
 *    Reading the first as missing would drop every dry hour.
 *
 * 3. THE STREAM'S startTime CARRIES NO OFFSET: "2025-06-26T00:00:00", while the
 *    scenario's carries -06:00. The weather is in the project's local time, and
 *    the scenario is the only place the file declares what that is. Timestamping
 *    rows in UTC instead would shift every observation by six hours — the same
 *    class of error as #402.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadFgmjProject } from '../loadFgmjProject.js';
import { resolveScenarios } from '../resolveScenarios.js';
import { extractWeatherStream } from '../extractWeatherStream.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA = path.resolve(__dirname, '..', '..', '..', '..', '..', 'test-data');

const best = () =>
  resolveScenarios(
    loadFgmjProject(path.join(TEST_DATA, 'prometheus_job_SS008-25_3scenarios.fgmj')),
  )[0];

describe('extractWeatherStream', () => {
  describe('the real stream', () => {
    it('reads every hour the file carries', () => {
      // 11 daily blocks: ten full days and a final hour.
      const { rows } = extractWeatherStream(best(), TEST_DATA);

      expect(rows).toHaveLength(241);
    });

    it('reads the first hour’s observations', () => {
      const { rows } = extractWeatherStream(best(), TEST_DATA);

      expect(rows[0].temp).toBeCloseTo(12.1, 4);
      expect(rows[0].rh).toBeCloseTo(91, 4);
      expect(rows[0].ws).toBeCloseTo(4, 6);
      expect(rows[0].wd).toBeCloseTo(264, 6);
    });

    it('keeps RH as a percentage, not a fraction', () => {
      const { rows } = extractWeatherStream(best(), TEST_DATA);

      // The patch ×100 must not reach this side.
      expect(rows[0].rh).toBeGreaterThan(1);
      expect(rows[0].rh).toBeLessThanOrEqual(100);
      expect(rows[0].rh).not.toBeCloseTo(9100, 0);
    });

    it('carries the starting codes through rather than inventing hourly ones', () => {
      const { startingCodes } = extractWeatherStream(best(), TEST_DATA);

      expect(startingCodes.ffmc).toBeCloseTo(87, 6);
      expect(startingCodes.dmc).toBeCloseTo(179, 6);
      expect(startingCodes.dc).toBeCloseTo(547, 6);
    });
  });

  describe('a zero scalar is a zero, not a gap', () => {
    it('reads a dry hour as 0 precipitation', () => {
      // The first hour has no `value` under precip, only the hex for zero.
      const { rows } = extractWeatherStream(best(), TEST_DATA);

      expect(rows[0].precip).toBe(0);
    });

    it('never leaves an observation undefined', () => {
      const { rows } = extractWeatherStream(best(), TEST_DATA);

      for (const row of rows) {
        expect(Number.isFinite(row.temp)).toBe(true);
        expect(Number.isFinite(row.rh)).toBe(true);
        expect(Number.isFinite(row.ws)).toBe(true);
        expect(Number.isFinite(row.wd)).toBe(true);
        expect(Number.isFinite(row.precip)).toBe(true);
      }
    });
  });

  describe('timestamps run in the project’s local time, not UTC', () => {
    it('starts at the stream start in the scenario’s offset', () => {
      const { rows } = extractWeatherStream(best(), TEST_DATA);

      // Stream says 2025-06-26T00:00:00 with no offset; the scenario says -06:00.
      expect(rows[0].date.toISOString()).toBe('2025-06-26T06:00:00.000Z');
    });

    it('advances one hour per row', () => {
      const { rows } = extractWeatherStream(best(), TEST_DATA);

      expect(rows[1].date.getTime() - rows[0].date.getTime()).toBe(3_600_000);
      expect(rows[23].date.getTime() - rows[0].date.getTime()).toBe(23 * 3_600_000);
    });

    it('crosses the day boundary without resetting', () => {
      const { rows } = extractWeatherStream(best(), TEST_DATA);

      expect(rows[24].date.getTime() - rows[23].date.getTime()).toBe(3_600_000);
    });
  });

  describe('stop and alert', () => {
    it('refuses an hour whose temperature message is absent entirely', () => {
      const scenario = best();
      const condition = (scenario.stream as Record<string, unknown>).condition as Record<
        string,
        unknown
      >;
      const days = (
        (condition.dailyConditions as Record<string, unknown>).dailyConditions as Record<
          string,
          unknown
        >[]
      );
      const hours = (days[0].hourWeather as Record<string, unknown>).hours as Record<
        string,
        unknown
      >[];
      delete hours[0].temp;

      expect(() => extractWeatherStream(scenario, TEST_DATA)).toThrow(/temp/i);
    });

    it('refuses a stream with no daily blocks', () => {
      const scenario = best();
      const condition = (scenario.stream as Record<string, unknown>).condition as Record<
        string,
        unknown
      >;
      (condition.dailyConditions as Record<string, unknown>).dailyConditions = [];

      expect(() => extractWeatherStream(scenario, TEST_DATA)).toThrow(/no weather|no daily|no file/i);
    });
  });
});
