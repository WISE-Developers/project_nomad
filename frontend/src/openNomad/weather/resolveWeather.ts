/**
 * Shared resolution of openNomad `WeatherParams` into the backend's weather
 * configuration. Lives in the openNomad tree so BOTH SAN and ACN resolve
 * weather the SAME way (refs #303).
 *
 * Key behaviour: an UPLOADED SpotWX forecast (`source: 'spotwx'` +
 * `spotwxCsvData`) is normalized to `raw_weather` here — it never becomes a
 * live SpotWX API call, so no SpotWX API key is required. A SpotWX request by
 * location (`spotwxLocation`, no upload) stays a live `spotwx` fetch.
 */

import type { WeatherParams, FWIStartingCodes } from '../api.js';
import { normalizeSpotwxToRawWeather } from './spotwxParser.js';

/** Backend-facing weather config (mirrors the backend WeatherConfig subset). */
export interface BackendWeatherConfig {
  source: 'firestarr_csv' | 'raw_weather' | 'spotwx';
  /** Raw weather CSV (no FWI columns) — for source 'raw_weather'. */
  rawWeatherContent?: string;
  /** FireSTARR-ready CSV — for source 'firestarr_csv'. */
  firestarrCsvContent?: string;
  /** Live SpotWX config — for source 'spotwx'. */
  spotwx?: { location?: { lat: number; lng: number } };
  /** Starting FWI codes for progressive CFFDRS calculation. */
  startingCodes?: FWIStartingCodes;
}

/**
 * Resolve openNomad `WeatherParams` to a backend weather config.
 *
 * Currently handles the `spotwx` source (uploaded → raw_weather, location →
 * live). Other sources ('csv', 'station') are not yet routed through the shared
 * resolver; they fail loudly rather than mis-map (fail-fast) and should be added
 * with their own tests when ACN needs them.
 */
export function resolveWeatherParams(weather: WeatherParams): BackendWeatherConfig {
  const { source, startingCodes } = weather;

  if (source === 'spotwx') {
    // Uploaded SpotWX forecast → normalize to raw_weather (no live API/key).
    if (weather.spotwxCsvData) {
      return {
        source: 'raw_weather',
        rawWeatherContent: normalizeSpotwxToRawWeather(weather.spotwxCsvData),
        ...(startingCodes ? { startingCodes } : {}),
      };
    }
    // Live SpotWX fetch by location.
    return {
      source: 'spotwx',
      ...(weather.spotwxLocation ? { spotwx: { location: weather.spotwxLocation } } : {}),
      ...(startingCodes ? { startingCodes } : {}),
    };
  }

  throw new Error(
    `resolveWeatherParams: source '${source}' is not yet supported by the shared resolver`
  );
}
