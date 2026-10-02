/**
 * Weather that lives in a file beside the job, not inside it (refs #294).
 *
 * Running the importer over the 65 real .fgmj files on disk found this: only 4
 * planned, and 41 of the 61 failures were one cause — the weather is EXTERNAL.
 * A WISE-produced job carries
 *
 *   condition: { dataImportedFromFile: true, filename: "Inputs/spotwx_forecast.txt",
 *                startTime, startingCodes }
 *
 * and no `dailyConditions` at all. extractWeatherStream read only the inline
 * form, so two thirds of the real corpus was refused for "no daily blocks".
 *
 * The referenced file SHIPS WITH THE JOB — 53 of 60 such references resolve on
 * disk — so this is readable rather than a dead end. It is resolved relative to
 * the .fgmj, because that is what the path is relative to.
 *
 * The format is a SpotWX forecast:
 *
 *   HOURLY,HOUR,TEMP,RH,WD,WS,PRECIP
 *   2021-09-02, 00, 10.9, 98, 320, 16, 0.00
 *
 * Date and hour in SEPARATE columns, and neither of Nomad's existing parsers
 * matches it: the raw parser needs an exact `date` column, and the SpotWX
 * parser's aliases are datetime/date/time/valid — none of which is `HOURLY`.
 * So the importer reads it and produces the same observations the inline path
 * does, leaving everything downstream unchanged.
 *
 * This fixture is also the first with REAL lat/lon ignition coordinates
 * (-112.2258, 55.678433, in Alberta), so the no-CRS-needed path finally has an
 * artifact behind it rather than a synthetic case.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import { planFgmjImport } from '../planFgmjImport.js';
import { validateImportedWeather } from '../validateImportedWeather.js';
import { toWeatherConfig } from '../toWeatherConfig.js';
import { toIgnitionGeometries } from '../toIgnitionGeometry.js';
import { GeometryType } from '../../../domain/entities/SpatialGeometry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA = path.resolve(__dirname, '..', '..', '..', '..', '..', 'test-data');
const WISE_JOB = path.join(TEST_DATA, 'wise_job_LWF-184-2021', 'job.fgmj');

describe('external weather', () => {
  describe('a WISE job whose weather is a sibling file', () => {
    it('plans at all, where it used to be refused outright', () => {
      const plans = planFgmjImport(WISE_JOB);

      expect(plans).toHaveLength(1);
      expect(plans[0].scenarioName).toBe('2021_AB_LWF-184-2021 3 Day Scenario');
    });

    it('reads every hour out of the referenced file', () => {
      const [plan] = planFgmjImport(WISE_JOB);

      // 242 lines: a header and 241 hourly rows. The file spans
      // 2021-09-02 00:00 to 2021-09-12 00:00, which is 10 days plus an hour —
      // so the count and the span corroborate each other rather than either
      // being taken on trust.
      expect(plan.weather).toHaveLength(241);
      const span =
        plan.weather[plan.weather.length - 1].date.getTime() - plan.weather[0].date.getTime();
      expect(span).toBe(240 * 3_600_000);
    });

    it('reads the first row’s observations', () => {
      const [plan] = planFgmjImport(WISE_JOB);

      expect(plan.weather[0].temp).toBeCloseTo(10.9, 6);
      expect(plan.weather[0].rh).toBeCloseTo(98, 6);
      expect(plan.weather[0].wd).toBeCloseTo(320, 6);
      expect(plan.weather[0].ws).toBeCloseTo(16, 6);
      expect(plan.weather[0].precip).toBeCloseTo(0, 6);
    });

    it('combines the separate date and hour columns into a timestamp', () => {
      const [plan] = planFgmjImport(WISE_JOB);

      // 2021-09-02 00:00 at -06:00 is 06:00Z.
      expect(plan.weather[0].date.toISOString()).toBe('2021-09-02T06:00:00.000Z');
      expect(plan.weather[1].date.getTime() - plan.weather[0].date.getTime()).toBe(
        3_600_000,
      );
    });

    it('still takes the starting codes from the job, not the weather file', () => {
      const [plan] = planFgmjImport(WISE_JOB);

      expect(plan.startingCodes.ffmc).toBeCloseTo(37, 6);
      expect(plan.startingCodes.dmc).toBeCloseTo(2, 6);
      expect(plan.startingCodes.dc).toBeCloseTo(297, 6);
    });
  });

  describe('a WISE job whose ignition is already lat/lon', () => {
    it('needs no CRS and is runnable as imported', () => {
      const [plan] = planFgmjImport(WISE_JOB);

      expect(plan.blockers).toEqual([]);
      expect(plan.runnable).toBe(true);
      expect(plan.latitude).toBeCloseTo(55.678433, 5);
      expect(plan.longitude).toBeCloseTo(-112.2258, 5);
    });

    it('produces a Point geometry without any operator input', () => {
      const [plan] = planFgmjImport(WISE_JOB);
      const [ignition] = toIgnitionGeometries(plan);

      expect(ignition.geometry.type).toBe(GeometryType.Point);
      expect(ignition.geometry.coordinates).toEqual([-112.2258, 55.678433]);
    });

    it('satisfies FireSTARR’s weather contract and hands over cleanly', () => {
      const [plan] = planFgmjImport(WISE_JOB);

      expect(validateImportedWeather(plan)).toEqual([]);
      const config = toWeatherConfig(plan);
      expect(config.source).toBe('raw_weather');
      expect(config.latitude).toBeCloseTo(55.678433, 5);
    });
  });

  describe('stop and alert', () => {
    it('refuses when the referenced file is not beside the job', () => {
      // 7 of 60 such references in the corpus do not resolve. Naming the path
      // it looked for is the difference between a fixable and a baffling error.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fgmj-noweather-'));
      const orphan = path.join(dir, 'job.fgmj');
      fs.copyFileSync(WISE_JOB, orphan);

      expect(() => planFgmjImport(orphan)).toThrow(/spotwx_forecast\.txt/);

      fs.rmSync(dir, { recursive: true, force: true });
    });
  });
});
