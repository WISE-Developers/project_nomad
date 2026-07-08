/**
 * #303 — An UPLOADED SpotWX forecast must be normalized to `raw_weather` in the
 * SHARED openNomad layer, so BOTH SAN and ACN submit it through the backend's
 * raw_weather pipeline and never hit the live-SpotWX API-key requirement.
 * (Live SpotWX by location stays source 'spotwx'.)
 */
import { describe, it, expect } from 'vitest';
import { resolveWeatherParams } from '../weather/resolveWeather.js';
import type { WeatherParams } from '../api.js';

const SPOTWX_UPLOAD =
  'DATETIME,DATE,TIME,TMP,RH,WS,WD,WG,APCP,CLOUD\n' +
  '2026/04/18 00:00,2026/04/18,00:00,-17.5,93,12,074,18,0.0,5\n' +
  '2026/04/18 01:00,2026/04/18,01:00,-18.5,98,11,088,12,0.3,6\n';

describe('resolveWeatherParams (shared openNomad weather resolution)', () => {
  it('normalizes an UPLOADED SpotWX forecast to a raw_weather config (no API-key path)', () => {
    const params = {
      source: 'spotwx',
      spotwxCsvData: SPOTWX_UPLOAD,
      startingCodes: { ffmc: 83.5, dmc: 53.7, dc: 568.9 },
    } as WeatherParams;

    const cfg = resolveWeatherParams(params);

    // Uploaded SpotWX -> raw_weather (NOT a live API fetch)
    expect(cfg.source).toBe('raw_weather');
    expect(cfg.rawWeatherContent).toMatch(/^Date,PREC,TEMP,RH,WS,WD/);
    expect(cfg.rawWeatherContent).toContain('2026-04-18 00:00:00,0.0,-17.5,93,12,074');
    expect(cfg.startingCodes).toEqual({ ffmc: 83.5, dmc: 53.7, dc: 568.9 });
    expect((cfg as { spotwx?: unknown }).spotwx).toBeUndefined();
  });

  it('keeps a live SpotWX request (location, no upload) as source "spotwx"', () => {
    const params = {
      source: 'spotwx',
      spotwxLocation: { lat: 60.82, lng: -115.7 },
    } as WeatherParams;

    const cfg = resolveWeatherParams(params);
    expect(cfg.source).toBe('spotwx');
  });
});
