/**
 * Shared weather utilities for the openNomad layer (SAN + ACN).
 */
export { resolveWeatherParams } from './resolveWeather.js';
export type { BackendWeatherConfig } from './resolveWeather.js';
export { parseSpotwxCsv, normalizeSpotwxToRawWeather } from './spotwxParser.js';
export type { NormalizedWeather } from './spotwxParser.js';
