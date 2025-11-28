/**
 * Weather Infrastructure
 *
 * Weather data handling and external API integration.
 */

export { WeatherService, getWeatherService, resetWeatherService } from './WeatherService.js';
export type {
  WeatherConfig,
  ManualWeatherInput,
  SpotWXConfig,
  WeatherDataPoint,
  WeatherLocation,
  WeatherDateRange,
} from './types.js';
