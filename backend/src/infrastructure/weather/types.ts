/**
 * Weather Data Types (re-export)
 *
 * The weather data contracts now live in the application layer
 * (`application/interfaces/weather.ts`) so that ports such as
 * {@link IFireModelingEngine} depend on the abstraction rather than on
 * infrastructure. This module re-exports them for the convenience of existing
 * infrastructure-relative importers (`./types.js`).
 */

export type {
  WeatherConfig,
  FWIStartingCodes,
  ManualWeatherInput,
  SpotWXConfig,
  WeatherDataPoint,
  WeatherLocation,
  WeatherDateRange,
} from '../../application/interfaces/weather.js';
