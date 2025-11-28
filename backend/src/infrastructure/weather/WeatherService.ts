/**
 * Weather Service
 *
 * Handles weather data resolution from manual input or external APIs.
 */

import type {
  WeatherConfig,
  ManualWeatherInput,
  WeatherDataPoint,
  WeatherLocation,
  WeatherDateRange,
} from './types.js';

/**
 * Weather service for resolving weather data.
 *
 * Supports:
 * - Manual FWI index input (creates hourly data from provided values)
 * - SpotWX API integration (future)
 */
export class WeatherService {
  /**
   * Resolves weather data based on configuration.
   *
   * @param config - Weather source configuration
   * @param location - Location for weather query
   * @param dateRange - Date range for weather data
   * @returns Array of hourly weather data points
   */
  async resolveWeather(
    config: WeatherConfig,
    location: WeatherLocation,
    dateRange: WeatherDateRange
  ): Promise<WeatherDataPoint[]> {
    if (config.source === 'manual') {
      if (!config.manual) {
        throw new Error('Manual weather data required when source is "manual"');
      }
      return this.createWeatherFromManual(config.manual, dateRange);
    }

    if (config.source === 'spotwx') {
      // SpotWX integration - use API key from config or env
      const apiKey = config.spotwx?.apiKey ?? process.env.SPOTWX_API_KEY;
      if (!apiKey) {
        throw new Error('SpotWX API key required (set SPOTWX_API_KEY or provide in request)');
      }
      return this.fetchFromSpotWX(apiKey, location, dateRange);
    }

    throw new Error(`Unknown weather source: ${config.source}`);
  }

  /**
   * Creates hourly weather data from manual FWI input.
   *
   * For manual input, we assume constant weather conditions throughout
   * the simulation period. This is suitable for short-term simulations
   * or when detailed forecast data is not available.
   *
   * @param manual - Manual weather input with FWI indices
   * @param dateRange - Date range to generate data for
   * @returns Array of hourly weather points
   */
  private createWeatherFromManual(
    manual: ManualWeatherInput,
    dateRange: WeatherDateRange
  ): WeatherDataPoint[] {
    const points: WeatherDataPoint[] = [];
    const current = new Date(dateRange.start);
    const end = new Date(dateRange.end);

    // Generate hourly data points
    while (current <= end) {
      // Calculate ISI, BUI, FWI from base indices
      const { isi, bui, fwi } = this.calculateFWI(
        manual.ffmc,
        manual.dmc,
        manual.dc,
        manual.windSpeed
      );

      points.push({
        datetime: new Date(current),
        temperature: manual.temperature,
        humidity: manual.humidity,
        windSpeed: manual.windSpeed,
        windDirection: manual.windDirection,
        precipitation: manual.precipitation ?? 0,
        ffmc: manual.ffmc,
        dmc: manual.dmc,
        dc: manual.dc,
        isi,
        bui,
        fwi,
      });

      // Advance by 1 hour
      current.setTime(current.getTime() + 60 * 60 * 1000);
    }

    console.log(`[WeatherService] Generated ${points.length} hourly weather points from manual input`);
    return points;
  }

  /**
   * Fetches weather data from SpotWX API.
   *
   * @param apiKey - SpotWX API key
   * @param location - Location coordinates
   * @param dateRange - Date range for forecast
   * @returns Array of hourly weather points
   */
  private async fetchFromSpotWX(
    _apiKey: string,
    location: WeatherLocation,
    dateRange: WeatherDateRange
  ): Promise<WeatherDataPoint[]> {
    // SpotWX API integration
    // API: https://spotwx.io/api/v2.1/data
    //
    // For now, throw an error - this will be implemented when SpotWX access is available
    console.log(`[WeatherService] SpotWX fetch requested for ${location.latitude}, ${location.longitude}`);
    console.log(`[WeatherService] Date range: ${dateRange.start.toISOString()} to ${dateRange.end.toISOString()}`);

    // TODO: Implement SpotWX API call
    // The API returns hourly forecast data including:
    // - Temperature, humidity, wind speed/direction
    // - Precipitation
    // - Optionally FWI indices (if available for the model)
    //
    // For now, throw an informative error
    throw new Error(
      'SpotWX integration not yet implemented. Please use manual weather input.'
    );
  }

  /**
   * Calculates FWI system indices from base components.
   *
   * Simplified calculation - for accurate FWI, use a proper
   * implementation of the Canadian FWI System equations.
   *
   * @param ffmc - Fine Fuel Moisture Code
   * @param dmc - Duff Moisture Code
   * @param dc - Drought Code
   * @param windSpeed - Wind speed in km/h
   * @returns ISI, BUI, and FWI values
   */
  private calculateFWI(
    ffmc: number,
    dmc: number,
    dc: number,
    windSpeed: number
  ): { isi: number; bui: number; fwi: number } {
    // Calculate moisture content from FFMC
    const m = 147.2 * (101 - ffmc) / (59.5 + ffmc);

    // Calculate wind function
    const fW = windSpeed >= 40
      ? 12 * (1 - Math.exp(-0.0818 * (windSpeed - 28)))
      : Math.exp(0.05039 * windSpeed);

    // Calculate fine fuel moisture function
    const fF = 91.9 * Math.exp(-0.1386 * m) * (1 + Math.pow(m, 5.31) / 49300000);

    // Initial Spread Index
    const isi = 0.208 * fW * fF;

    // Buildup Index
    let bui: number;
    if (dmc <= 0.4 * dc) {
      bui = (0.8 * dmc * dc) / (dmc + 0.4 * dc);
    } else {
      bui = dmc - (1 - 0.8 * dc / (dmc + 0.4 * dc)) * (0.92 + Math.pow(0.0114 * dmc, 1.7));
    }
    bui = Math.max(0, bui);

    // Fire Weather Index
    let fwi: number;
    if (bui <= 80) {
      fwi = 0.1 * isi * (0.626 * Math.pow(bui, 0.809) + 2);
    } else {
      fwi = 0.1 * isi * (1000 / (25 + 108.64 * Math.exp(-0.023 * bui)));
    }

    // Apply log scaling if FWI > 1
    if (fwi > 1) {
      fwi = Math.exp(2.72 * Math.pow(0.434 * Math.log(fwi), 0.647));
    }

    return {
      isi: Math.round(isi * 10) / 10,
      bui: Math.round(bui * 10) / 10,
      fwi: Math.round(fwi * 10) / 10,
    };
  }
}

/**
 * Singleton instance
 */
let instance: WeatherService | null = null;

export function getWeatherService(): WeatherService {
  if (!instance) {
    instance = new WeatherService();
  }
  return instance;
}

export function resetWeatherService(): void {
  instance = null;
}
