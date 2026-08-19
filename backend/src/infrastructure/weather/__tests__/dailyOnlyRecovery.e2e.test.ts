/**
 * End-to-end recovery of a daily-only CFFDRS file — issues #350, #351.
 *
 * The failure this reproduces: a FireSTARR-format CSV recording its indices
 * once a day parsed to NaN on every other row, those NaNs were written to
 * weather.csv AND placed on the FireSTARR command line, and the engine died
 * with SIGSEGV. vita hit it six times in a week on the CIFFC demo.
 *
 * The fixture reproduces the SHAPE of her file — hourly observations at :06
 * with the indices on the 19:06 row only. The first four daily readings are the
 * exact values recorded in #351; the rest continue the trend and are invented.
 *
 * This covers the whole recovery: detect the shape, recover the codes, run them
 * through the raw_weather path, and confirm nothing non-finite survives.
 */

import { describe, it, expect } from 'vitest';
import { WeatherService } from '../WeatherService.js';
import { hasDailyOnlyCffdrs, findStartingCodeCandidate } from '../dailyCffdrs.js';
import { validateWeatherData } from '../../firestarr/WeatherCSVWriter.js';

const ZONE = 'America/Edmonton';
const IGNITION = new Date('2026-08-04T18:00:00.000Z'); // 12:00 local

const DAILY_READINGS: Record<string, [number, number, number]> = {
  '2026-08-01': [81.66, 19.22, 412.67],
  '2026-08-02': [76.3, 18.52, 418.6],
  '2026-08-03': [84.65, 20.72, 424.9],
  '2026-08-04': [88.44, 23.66, 432.05],
};

const TEMPS = [16.1, 15.4, 14.9, 14.5, 14.2, 15.0, 17.3, 19.8, 21.9, 23.4, 24.4, 25.1,
  25.8, 26.3, 26.6, 26.4, 25.7, 24.8, 23.8, 22.1, 20.4, 19.0, 17.9, 16.9];
const RHS = [72, 75, 78, 80, 82, 79, 70, 60, 52, 48, 46, 43, 41, 39, 38, 39, 43, 50, 61, 66, 69, 71, 72, 73];

function vitaShapedCsv(): string {
  const lines = ['Scenario,Date,PREC,TEMP,RH,WS,WD,FFMC,DMC,DC,ISI,BUI,FWI'];

  for (const [day, [ffmc, dmc, dc]] of Object.entries(DAILY_READINGS)) {
    for (let hour = 0; hour < 24; hour++) {
      const stamp = `${day} ${String(hour).padStart(2, '0')}:06:00`;
      const observation = `0,${stamp},0,${TEMPS[hour]},${RHS[hour]},8.0,222`;

      lines.push(
        hour === 19
          ? `${observation.replace(',222', ',217')},${ffmc},${dmc},${dc},2,34.44,4.64`
          : `${observation},NaN,NaN,NaN,NaN,NaN,NaN`,
      );
    }
  }

  return lines.join('\n');
}

const service = new WeatherService();

describe("vita's file, end to end", () => {
  it('parses to NaN when taken at face value — the original failure', async () => {
    const points = await service.resolveWeather(
      { source: 'firestarr_csv', firestarrCsvContent: vitaShapedCsv(), timezone: ZONE },
      { latitude: 53.5, longitude: -113.5 },
      { start: IGNITION, end: IGNITION },
    );

    // 92 of 96 rows carry no indices at all.
    expect(points.some((p) => !Number.isFinite(p.ffmc))).toBe(true);
  });

  it('is now REJECTED by validation instead of reaching the engine (#350)', async () => {
    const points = await service.resolveWeather(
      { source: 'firestarr_csv', firestarrCsvContent: vitaShapedCsv(), timezone: ZONE },
      { latitude: 53.5, longitude: -113.5 },
      { start: IGNITION, end: IGNITION },
    );

    const result = validateWeatherData(
      points.map((p) => ({
        date: p.datetime,
        temp: p.temperature,
        rh: p.humidity,
        ws: p.windSpeed,
        wd: p.windDirection,
        precip: p.precipitation,
        ffmc: p.ffmc,
        dmc: p.dmc,
        dc: p.dc,
        isi: p.isi ?? 0,
        bui: p.bui ?? 0,
        fwi: p.fwi ?? 0,
      })) as Parameters<typeof validateWeatherData>[0],
    );

    expect(result.valid).toBe(false);
  });

  it('recovers the codes the file already contains (#351)', async () => {
    const points = await service.resolveWeather(
      { source: 'firestarr_csv', firestarrCsvContent: vitaShapedCsv(), timezone: ZONE },
      { latitude: 53.5, longitude: -113.5 },
      { start: IGNITION, end: IGNITION },
    );

    expect(hasDailyOnlyCffdrs(points)).toBe(true);

    const candidate = findStartingCodeCandidate(points, IGNITION, ZONE);
    expect(candidate).not.toBeNull();
    expect([candidate!.ffmc, candidate!.dmc, candidate!.dc]).toEqual([84.65, 20.72, 424.9]);
  });

  it('produces a fully finite series once those codes are accepted', async () => {
    // The payoff. Same file, raw_weather path, codes recovered from the file
    // itself — every row now carries real numbers.
    const points = await service.resolveWeather(
      {
        source: 'raw_weather',
        rawWeatherContent: vitaShapedCsv(),
        startingCodes: { ffmc: 84.65, dmc: 20.72, dc: 424.9 },
        latitude: 53.5,
        timezone: ZONE,
      },
      { latitude: 53.5, longitude: -113.5 },
      { start: IGNITION, end: IGNITION },
    );

    expect(points.length).toBe(96);
    for (const point of points) {
      expect(Number.isFinite(point.ffmc)).toBe(true);
      expect(Number.isFinite(point.dmc)).toBe(true);
      expect(Number.isFinite(point.dc)).toBe(true);
    }
  });

  it('passes the validation that used to let NaN through to the command line', async () => {
    const points = await service.resolveWeather(
      {
        source: 'raw_weather',
        rawWeatherContent: vitaShapedCsv(),
        startingCodes: { ffmc: 84.65, dmc: 20.72, dc: 424.9 },
        latitude: 53.5,
        timezone: ZONE,
      },
      { latitude: 53.5, longitude: -113.5 },
      { start: IGNITION, end: IGNITION },
    );

    const result = validateWeatherData(
      points.map((p) => ({
        date: p.datetime,
        temp: p.temperature,
        rh: p.humidity,
        ws: p.windSpeed,
        wd: p.windDirection,
        precip: p.precipitation,
        ffmc: p.ffmc,
        dmc: p.dmc,
        dc: p.dc,
        isi: p.isi ?? 0,
        bui: p.bui ?? 0,
        fwi: p.fwi ?? 0,
      })) as Parameters<typeof validateWeatherData>[0],
    );

    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });
});
