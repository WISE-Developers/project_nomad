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
import { formatLocalDateTime } from './timezoneUtils.js';

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
 * Formats a number for CSV output.
 * Uses up to 2 decimal places, removes trailing zeros.
 */
function formatNumber(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/**
 * Converts weather data to a CSV row.
 */
function weatherToRow(weather: WeatherHourlyData, scenarioId: number, timezone: string): string {
  const values = [
    scenarioId.toString(),
    formatLocalDateTime(weather.date, timezone),
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
  /** IANA timezone identifier for CSV timestamps. Required — must match engine `--tz`. */
  timezone: string;
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
  options: WeatherCSVOptions
): Promise<void> {
  if (typeof options?.timezone !== 'string' || options.timezone.length === 0) {
    throw new Error(
      'WeatherCSVWriter: IANA timezone is required (no runtime-zone fallback). ' +
      'Caller must pass options.timezone matching the engine --tz value.',
    );
  }
  const scenarioId = options.scenarioId ?? 0;
  const timezone = options.timezone;

  // Build CSV content
  const lines: string[] = [
    CSV_HEADERS.join(','),
    ...weatherData.map((w) => weatherToRow(w, scenarioId, timezone)),
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
/** At most this many example row numbers per grouped issue. */
const MAX_EXAMPLE_ROWS = 5;
/** At most this many distinct gap sizes named in the distribution. */
const MAX_GAP_KINDS = 5;

/** "rows 3, 8, 12 and 240 more" — enough to go and look without listing everything. */
function describeRows(rows: number[]): string {
  const shown = rows.slice(0, MAX_EXAMPLE_ROWS).join(', ');
  const rest = rows.length - Math.min(rows.length, MAX_EXAMPLE_ROWS);
  return rest > 0 ? `rows ${shown} and ${rest} more` : `row${rows.length > 1 ? 's' : ''} ${shown}`;
}

/**
 * Summarises the hourly-continuity failures — issue #342.
 *
 * One issue per observation pair produced a 355 KB message with 5,928 lines on
 * the CIFFC demo, and the single sentence that mattered — the file is daily
 * observations in reverse chronological order — was buried in it. The gap
 * DISTRIBUTION carries that conclusion, so report the distribution and state the
 * conclusion outright.
 */
function summariseGaps(weatherData: WeatherHourlyData[]): string[] {
  const countByGap = new Map<number, number>();
  let offending = 0;

  for (let i = 1; i < weatherData.length; i++) {
    const hourDiff =
      (weatherData[i].date.getTime() - weatherData[i - 1].date.getTime()) / (1000 * 60 * 60);

    if (Math.abs(hourDiff - 1) > 0.1) {
      offending += 1;
      const rounded = Math.round(hourDiff * 10) / 10;
      countByGap.set(rounded, (countByGap.get(rounded) ?? 0) + 1);
    }
  }

  if (offending === 0) return [];

  const ranked = [...countByGap.entries()].sort((a, b) => b[1] - a[1]);
  const distribution = ranked
    .slice(0, MAX_GAP_KINDS)
    .map(([gap, count]) => `${gap}h x${count}`)
    .join(', ');
  const omitted = ranked.length - Math.min(ranked.length, MAX_GAP_KINDS);

  const parts = [
    `${offending} observation${offending > 1 ? 's are' : ' is'} not one hour after the previous one. ` +
      `Gap distribution: ${distribution}${omitted > 0 ? `, and ${omitted} other gap sizes` : ''}.`,
  ];

  // State the conclusion rather than leaving it to be inferred from the counts.
  const allNegative = ranked.every(([gap]) => gap < 0);
  const mostlyDaily = ranked[0] !== undefined && Math.abs(Math.abs(ranked[0][0]) - 24) < 0.5;

  if (allNegative && mostlyDaily) {
    parts.push(
      'These are daily steps running backwards, so the file is in reverse chronological order ' +
        '(newest first) at daily resolution. FireSTARR needs hourly observations in ascending order.',
    );
  } else if (allNegative) {
    parts.push(
      'Every gap is negative, so the observations are in reverse chronological order (newest first). ' +
        'FireSTARR needs them ascending.',
    );
  } else if (mostlyDaily) {
    parts.push('These are daily steps. FireSTARR needs hourly observations.');
  }

  return parts;
}

/**
 * Validates a weather series for FireSTARR.
 *
 * Reporting is GROUPED, not per row (#342). Every problem is still detected;
 * they are collapsed by field and by gap size so the message stays small enough
 * to store in jobs.error and ship to a browser, and so the diagnosis survives
 * being read by a human.
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

  issues.push(...summariseGaps(weatherData));

  // Collect per-row problems keyed by what is wrong, so 500 broken rows become
  // one line per field rather than 500 lines.
  const nonFinite = new Map<string, number[]>();
  const outOfRange = new Map<string, number[]>();

  const record = (bucket: Map<string, number[]>, key: string, row: number): void => {
    const rows = bucket.get(key);
    if (rows) rows.push(row);
    else bucket.set(key, [row]);
  };

  for (let i = 0; i < weatherData.length; i++) {
    const w = weatherData[i];

    // Finiteness must be checked BEFORE any range check. Every comparison with
    // NaN is false, so `w.ffmc < 0 || w.ffmc > 101` calls NaN valid. That is how
    // NaN reached FireSTARR on 2026-08-17 and segfaulted it (exit 139). See #350.
    const numericFields: Array<[string, number]> = [
      ['temp', w.temp],
      ['rh', w.rh],
      ['ws', w.ws],
      ['wd', w.wd],
      ['precip', w.precip],
      ['ffmc', w.ffmc],
      ['dmc', w.dmc],
      ['dc', w.dc],
      ['isi', w.isi],
      ['bui', w.bui],
      ['fwi', w.fwi],
    ];
    for (const [name, value] of numericFields) {
      if (!Number.isFinite(value)) record(nonFinite, name, i);
    }

    if (w.rh < 0 || w.rh > 100) record(outOfRange, 'RH must be within [0-100]', i);
    if (w.wd < 0 || w.wd > 360) record(outOfRange, 'Wind direction must be within [0-360]', i);
    if (w.ffmc < 0 || w.ffmc > 101) record(outOfRange, 'FFMC must be within [0-101]', i);
    if (w.ws < 0) record(outOfRange, 'Wind speed must not be negative', i);
    if (w.precip < 0) record(outOfRange, 'Precipitation must not be negative', i);
  }

  for (const [field, rows] of nonFinite) {
    issues.push(
      `${field} is not a finite number on ${rows.length} row${rows.length > 1 ? 's' : ''} (${describeRows(rows)}).`,
    );
  }

  for (const [rule, rows] of outOfRange) {
    issues.push(`${rule} — breached on ${rows.length} row${rows.length > 1 ? 's' : ''} (${describeRows(rows)}).`);
  }

  return { valid: issues.length === 0, issues };
}
