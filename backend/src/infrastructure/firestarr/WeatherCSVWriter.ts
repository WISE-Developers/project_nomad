/**
 * Weather CSV Writer for FireSTARR
 *
 * Generates weather CSV files in the exact format required by FireSTARR.
 * Column order and names are CRITICAL - FireSTARR will fail with incorrect format.
 *
 * Format: Scenario,Date,PREC,TEMP,RH,WS,WD,FFMC,DMC,DC,ISI,BUI,FWI
 */

import { writeFile } from 'fs/promises';
import { WeatherHourlyData } from './types.js';

/**
 * CSV column headers in required order.
 * WARNING: Do not change order or capitalization!
 */
const CSV_HEADERS = [
  'Scenario',
  'Date',
  'PREC',
  'TEMP',
  'RH',
  'WS',
  'WD',
  'FFMC',
  'DMC',
  'DC',
  'ISI',
  'BUI',
  'FWI',
] as const;

/**
 * Formats a date for FireSTARR CSV.
 * Format: YYYY-MM-DD HH:MM:SS (no T separator, no timezone)
 */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Formats a number for CSV output.
 * Uses up to 2 decimal places, removes trailing zeros.
 */
function formatNumber(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/**
 * Converts weather data to a CSV row.
 */
function weatherToRow(weather: WeatherHourlyData, scenarioId: number): string {
  const values = [
    scenarioId.toString(),
    formatDate(weather.date),
    formatNumber(weather.precip),
    formatNumber(weather.temp),
    formatNumber(weather.rh),
    formatNumber(weather.ws),
    formatNumber(weather.wd),
    formatNumber(weather.ffmc),
    formatNumber(weather.dmc),
    formatNumber(weather.dc),
    formatNumber(weather.isi),
    formatNumber(weather.bui),
    formatNumber(weather.fwi),
  ];

  return values.join(',');
}

/**
 * Options for weather CSV generation.
 */
export interface WeatherCSVOptions {
  /** Scenario ID (default: 0 for deterministic runs) */
  scenarioId?: number;
}

/**
 * Writes weather data to a CSV file in FireSTARR format.
 *
 * @param filePath - Output file path
 * @param weatherData - Array of hourly weather observations
 * @param options - Optional generation settings
 *
 * @example
 * ```typescript
 * await writeWeatherCSV('/path/to/weather.csv', [
 *   { date: new Date('2024-06-03T00:00:00'), temp: 16.3, rh: 35, ws: 10, wd: 88, precip: 0, ffmc: 89.9, dmc: 59.5, dc: 450.9, isi: 6.99, bui: 89.48, fwi: 23.31 },
 *   // ... more hourly data
 * ]);
 * ```
 */
export async function writeWeatherCSV(
  filePath: string,
  weatherData: WeatherHourlyData[],
  options: WeatherCSVOptions = {}
): Promise<void> {
  const scenarioId = options.scenarioId ?? 0;

  // Build CSV content
  const lines: string[] = [
    CSV_HEADERS.join(','),
    ...weatherData.map((w) => weatherToRow(w, scenarioId)),
  ];

  const content = lines.join('\n') + '\n';

  // Write to file
  await writeFile(filePath, content, 'utf-8');

  console.log(`[WeatherCSVWriter] Wrote ${weatherData.length} hours to ${filePath}`);
}

/**
 * Validates weather data before writing.
 *
 * @param weatherData - Array of weather observations
 * @returns Validation result with any issues found
 */
export function validateWeatherData(weatherData: WeatherHourlyData[]): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  if (weatherData.length === 0) {
    issues.push('Weather data is empty');
    return { valid: false, issues };
  }

  // Check for required hourly coverage
  for (let i = 1; i < weatherData.length; i++) {
    const prev = weatherData[i - 1].date.getTime();
    const curr = weatherData[i].date.getTime();
    const hourDiff = (curr - prev) / (1000 * 60 * 60);

    if (Math.abs(hourDiff - 1) > 0.1) {
      issues.push(`Non-hourly gap between observations ${i - 1} and ${i}: ${hourDiff} hours`);
    }
  }

  // Validate value ranges
  for (let i = 0; i < weatherData.length; i++) {
    const w = weatherData[i];

    if (w.rh < 0 || w.rh > 100) {
      issues.push(`Row ${i}: RH ${w.rh} out of range [0-100]`);
    }
    if (w.wd < 0 || w.wd > 360) {
      issues.push(`Row ${i}: Wind direction ${w.wd} out of range [0-360]`);
    }
    if (w.ffmc < 0 || w.ffmc > 101) {
      issues.push(`Row ${i}: FFMC ${w.ffmc} out of range [0-101]`);
    }
    if (w.ws < 0) {
      issues.push(`Row ${i}: Wind speed ${w.ws} is negative`);
    }
    if (w.precip < 0) {
      issues.push(`Row ${i}: Precipitation ${w.precip} is negative`);
    }
  }

  return { valid: issues.length === 0, issues };
}
