/**
 * Handing imported weather to Nomad, which already computes the rest
 * (refs #294).
 *
 * Every .fgmj carries STARTING CFFDRS codes — ffmc 87, dmc 179, dc 547 in the
 * sample. That is all the importer needs to pass along: Nomad already steps
 * them forward with the real `cffdrs` library, through
 * WeatherService.resolveWeather with source 'raw_weather'.
 *
 * So the importer does NOT compute fire weather. It emits raw observations plus
 * the starting codes and lets the existing path do what it already does. The
 * alternative — a third copy of the FWI stepping loop living in the importer —
 * would duplicate science that is already implemented and tested here, and
 * `tools/extract-wise-jobs.ts` shows where that road ends: it holds the codes
 * CONSTANT for every hour, with the comment "proper FWI hourly calculation is
 * complex".
 *
 * The last case feeds the output into the REAL WeatherService and asserts the
 * codes come back computed. That is the only assertion that proves the handoff
 * works rather than merely looking plausible.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { planFgmjImport } from '../planFgmjImport.js';
import { resolveProjection } from '../resolveProjection.js';
import { toWeatherConfig } from '../toWeatherConfig.js';
import { WeatherService } from '../../../infrastructure/weather/WeatherService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA = path.resolve(__dirname, '..', '..', '..', '..', '..', 'test-data');
const fixture = (n: string) => path.join(TEST_DATA, n);
const THREE = 'prometheus_job_SS008-25_3scenarios.fgmj';

/** ESRI:102001 — Canada Albers, the sample's real CRS. */
const ALBERS =
  '+proj=aea +lat_0=40 +lon_0=-96 +lat_1=50 +lat_2=70 +datum=NAD83 +units=m +no_defs';

const resolvedBest = async () => {
  const [best] = planFgmjImport(fixture(THREE));
  return resolveProjection(best, ALBERS);
};

describe('toWeatherConfig', () => {
  describe('it refuses to run ahead of the CRS', () => {
    it('throws when the plan still has no latitude', () => {
      const [best] = planFgmjImport(fixture(THREE));
      expect(best.latitude).toBeUndefined();

      // CFFDRS needs latitude for the day-length adjustment in DMC and DC.
      expect(() => toWeatherConfig(best)).toThrow(/latitude|CRS/i);
    });
  });

  describe('what it hands over', () => {
    it('uses the raw_weather source, so Nomad computes the codes', async () => {
      const config = toWeatherConfig(await resolvedBest());

      expect(config.source).toBe('raw_weather');
      expect(config.firestarrCsvContent).toBeUndefined();
    });

    it('passes the starting codes straight from the file', async () => {
      const config = toWeatherConfig(await resolvedBest());

      expect(config.startingCodes?.ffmc).toBeCloseTo(87, 6);
      expect(config.startingCodes?.dmc).toBeCloseTo(179, 6);
      expect(config.startingCodes?.dc).toBeCloseTo(547, 6);
    });

    it('passes the reprojected latitude and the file’s offset', async () => {
      const plan = await resolvedBest();
      const config = toWeatherConfig(plan);

      expect(config.latitude).toBeCloseTo(60.2698, 3);
      expect(config.timezone).toBe('-06:00');
    });
  });

  describe('the CSV it writes', () => {
    it('carries the columns the raw parser looks for, and no FWI columns', async () => {
      const config = toWeatherConfig(await resolvedBest());
      const header = config.rawWeatherContent!.split('\n')[0];

      expect(header).toBe('Date,PREC,TEMP,RH,WS,WD');
      expect(header).not.toMatch(/FFMC|DMC|DC|ISI|BUI|FWI/);
    });

    it('writes local times with no offset, as that parser expects', async () => {
      const config = toWeatherConfig(await resolvedBest());
      const [, firstRow] = config.rawWeatherContent!.split('\n');

      // The stream starts 00:00 local on the 26th. The offset travels in
      // config.timezone, not in the timestamps.
      expect(firstRow).toMatch(/^2025-06-26 00:00,/);
      expect(firstRow).not.toMatch(/[+-]\d{2}:\d{2}|Z/);
    });

    it('writes every hour the plan carries', async () => {
      const plan = await resolvedBest();
      const config = toWeatherConfig(plan);
      const rows = config.rawWeatherContent!.trim().split('\n').slice(1);

      expect(rows).toHaveLength(plan.weather.length);
      expect(rows).toHaveLength(241);
    });

    it('writes the observations themselves', async () => {
      const config = toWeatherConfig(await resolvedBest());
      const [, firstRow] = config.rawWeatherContent!.split('\n');
      const [, prec, temp, rh, ws, wd] = firstRow.split(',');

      expect(Number(prec)).toBeCloseTo(0, 6);
      expect(Number(temp)).toBeCloseTo(12.1, 2);
      expect(Number(rh)).toBeCloseTo(91, 2);
      expect(Number(ws)).toBeCloseTo(4, 6);
      expect(Number(wd)).toBeCloseTo(264, 6);
    });
  });

  describe('Nomad really does the rest', () => {
    it('comes back from the real WeatherService with computed FWI codes', async () => {
      const plan = await resolvedBest();
      const config = toWeatherConfig(plan);

      const points = await new WeatherService().resolveWeather(
        config,
        { latitude: plan.latitude!, longitude: plan.longitude! },
        { start: plan.weather[0].date, end: plan.weather[plan.weather.length - 1].date },
      );

      expect(points).toHaveLength(241);
      // The importer supplied none of these; cffdrs produced them.
      expect(points[0].ffmc).toBeGreaterThan(0);
      expect(points[0].dmc).toBeGreaterThan(0);
      expect(points[0].dc).toBeGreaterThan(0);
      // And they start from the codes the file gave, not from nothing.
      expect(points[0].dc).toBeGreaterThan(500);
    });
  });
});
