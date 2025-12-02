/**
 * Weather Data Types
 *
 * Types for weather data handling and API integration.
 */

/**
 * Weather data configuration from API request
 */
export interface WeatherConfig {
  source: 'firestarr_csv' | 'raw_weather' | 'spotwx';

  /** FireSTARR-ready CSV content (when source is 'firestarr_csv') */
  firestarrCsvContent?: string;

  /** Raw weather CSV content without FWI columns (when source is 'raw_weather') */
  rawWeatherContent?: string;

  /** Starting codes for CFFDRS calculation (when source is 'raw_weather') */
  startingCodes?: FWIStartingCodes;

  /** Latitude for CFFDRS calculation (required for raw_weather) */
  latitude?: number;

  /** SpotWX configuration - used when source is 'spotwx' */
  spotwx?: SpotWXConfig;
}

/**
 * FWI starting codes for progressive calculation
 */
export interface FWIStartingCodes {
  /** Fine Fuel Moisture Code (0-101) */
  ffmc: number;
  /** Duff Moisture Code (0+) */
  dmc: number;
  /** Drought Code (0+) */
  dc: number;
}

/**
 * Manual weather input with FWI indices
 */
export interface ManualWeatherInput {
  /** Fine Fuel Moisture Code (0-101) */
  ffmc: number;
  /** Duff Moisture Code (0+) */
  dmc: number;
  /** Drought Code (0+) */
  dc: number;
  /** Wind speed in km/h */
  windSpeed: number;
  /** Wind direction in degrees (0-360) */
  windDirection: number;
  /** Temperature in Celsius */
  temperature: number;
  /** Relative humidity (0-100%) */
  humidity: number;
  /** Optional precipitation in mm */
  precipitation?: number;
}

/**
 * SpotWX API configuration
 */
export interface SpotWXConfig {
  /** API key (optional - uses env var if not provided) */
  apiKey?: string;
}

/**
 * Hourly weather data point
 * Format required by FireSTARR weather.csv
 */
export interface WeatherDataPoint {
  /** Date/time of the weather observation */
  datetime: Date;
  /** Temperature in Celsius */
  temperature: number;
  /** Relative humidity (0-100) */
  humidity: number;
  /** Wind speed in km/h */
  windSpeed: number;
  /** Wind direction in degrees (0-360) */
  windDirection: number;
  /** Precipitation in mm */
  precipitation: number;
  /** Fine Fuel Moisture Code */
  ffmc: number;
  /** Duff Moisture Code */
  dmc: number;
  /** Drought Code */
  dc: number;
  /** Initial Spread Index (calculated) */
  isi?: number;
  /** Buildup Index (calculated) */
  bui?: number;
  /** Fire Weather Index (calculated) */
  fwi?: number;
}

/**
 * Location for weather queries
 */
export interface WeatherLocation {
  latitude: number;
  longitude: number;
}

/**
 * Date range for weather queries
 */
export interface WeatherDateRange {
  start: Date;
  end: Date;
}
