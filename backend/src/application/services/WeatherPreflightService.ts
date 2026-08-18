/**
 * Pre-flight weather inspection — issue #351.
 *
 * Answers one question before a model exists: does this weather file have the
 * daily-only CFFDRS shape, and if so what starting codes does it already
 * contain? Creates nothing. No model, no job, no simulation directory — so a
 * "no" from the user costs nothing to clean up.
 */

import { getWeatherService } from '../../infrastructure/weather/WeatherService.js';
import {
  hasDailyOnlyCffdrs,
  findStartingCodeCandidate,
  type StartingCodeCandidate,
} from '../../infrastructure/weather/dailyCffdrs.js';
import type { WeatherConfig } from '../interfaces/weather.js';
import { ValidationError } from '../../domain/errors/index.js';

export interface WeatherPreflightResult {
  /** True only for the recoverable shape: some rows carry codes, others do not. */
  dailyOnlyCffdrs: boolean;
  /** The reading to offer, or null when none precedes ignition. Never invented. */
  candidate: StartingCodeCandidate | null;
}

/**
 * @param weather  the config as it would be submitted to /models/run
 * @param ignition the model's start instant — timeRange.start, which is the
 *                 only temporal anchor the request carries
 * @param timezone IANA identifier, used to read the CSV's naive timestamps and
 *                 to label the reading for a human
 */
export async function preflightWeather(
  weather: WeatherConfig,
  ignition: Date,
  timezone: string,
): Promise<WeatherPreflightResult> {
  // Only firestarr_csv can have this shape. raw_weather carries explicit
  // starting codes already, and spotwx is generated rather than uploaded.
  if (weather.source !== 'firestarr_csv') {
    return { dailyOnlyCffdrs: false, candidate: null };
  }

  let rows;
  try {
    rows = await getWeatherService().resolveWeather(
      { ...weather, timezone },
      // The firestarr_csv branch reads neither location nor dateRange —
      // resolveWeather:78-94 forwards only content and timezone to
      // parseFirestarrCsv. These are placeholders for a signature, not inputs.
      { latitude: 0, longitude: 0 },
      { start: ignition, end: ignition },
    );
  } catch (error) {
    // A malformed file is the user's problem to see, not a 500.
    const message = error instanceof Error ? error.message : String(error);
    throw new ValidationError(`Could not parse the weather CSV: ${message}`);
  }

  if (!hasDailyOnlyCffdrs(rows)) {
    return { dailyOnlyCffdrs: false, candidate: null };
  }

  return {
    dailyOnlyCffdrs: true,
    candidate: findStartingCodeCandidate(rows, ignition, timezone),
  };
}
