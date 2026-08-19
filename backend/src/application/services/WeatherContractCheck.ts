/**
 * Pre-run weather contract check — issues #339, #340, #341.
 *
 * Resolves the weather exactly as the engine will, then checks it against
 * FireSTARR's input contract BEFORE a model or job exists. A failure here is a
 * 400 naming the problem, not a queued job that dies ten seconds later with the
 * reason buried in the container log.
 */

import { getWeatherService } from '../../infrastructure/weather/WeatherService.js';
import { validateFireStarrContract } from '../../infrastructure/firestarr/weatherContract.js';
import { ValidationError } from '../../domain/errors/index.js';
import type { WeatherConfig, WeatherLocation, WeatherDateRange } from '../interfaces/weather.js';

/**
 * @throws ValidationError when the weather cannot be resolved, or when it does
 *         not satisfy the contract. Every problem is reported at once so the
 *         user fixes them in one pass rather than one failed run at a time.
 */
export async function assertWeatherMeetsEngineContract(
  weather: WeatherConfig,
  ignition: Date,
  timezone: string,
  location: WeatherLocation,
  dateRange: WeatherDateRange,
): Promise<void> {
  let points;
  try {
    points = await getWeatherService().resolveWeather({ ...weather, timezone }, location, dateRange);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ValidationError(`The weather could not be read: ${message}`, [
      { field: 'weather', message },
    ]);
  }

  const result = validateFireStarrContract(points, ignition, timezone);
  if (!result.valid) {
    throw new ValidationError(result.issues.join(' '), [
      { field: 'weather', message: result.issues.join(' ') },
    ]);
  }
}
