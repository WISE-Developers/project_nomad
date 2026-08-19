/**
 * Weather CSV Validation
 *
 * Validates weather CSV files at upload time before they reach the backend.
 * Catches formatting issues early so users get immediate feedback.
 */

/** Required columns for raw weather files */
export const REQUIRED_COLUMNS = ['Date', 'PREC', 'TEMP', 'RH', 'WS', 'WD'];

/** FWI code columns (present in FireSTARR CSV, absent in raw weather) */
export const FWI_COLUMNS = ['FFMC', 'DMC', 'DC', 'ISI', 'BUI', 'FWI'];

/**
 * Parse a CSV string into headers and rows.
 */
export function parseCSV(content: string): { headers: string[]; rows: string[][] } {
  const lines = content.trim().split('\n');
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = lines[0].split(',').map((h) => h.trim());
  const rows = lines.slice(1)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split(',').map((cell) => cell.trim()));

  return { headers, rows };
}

/**
 * Validate that all required columns are present.
 */
export function validateColumns(headers: string[]): { valid: boolean; missing: string[] } {
  const headerSet = new Set(headers.map((h) => h.toUpperCase()));
  const missing = REQUIRED_COLUMNS.filter((col) => !headerSet.has(col.toUpperCase()));
  return { valid: missing.length === 0, missing };
}

/**
 * Check if a date string contains a time component.
 * Accepts formats like "2024-06-21 15:00:00", "2024-06-21T15:00", etc.
 */
export function dateStringHasTime(dateStr: string): boolean {
  // Must have at least HH:MM after the date portion
  return /\d{4}-\d{2}-\d{2}[\sT]\d{1,2}:\d{2}/.test(dateStr.trim());
}

/**
 * Validate that datetime values in the CSV produce proper hourly intervals.
 *
 * Checks:
 * 1. Date values must contain timestamps OR a separate Hour column must exist
 * 2. Parsed datetimes must produce ~1-hour gaps between consecutive rows
 *
 * Returns validation result with specific error messages for the user.
 */
export function validateDatetimes(
  headers: string[],
  rows: string[][],
): { valid: boolean; error?: string; hasHourColumn: boolean } {
  const headerUpper = headers.map((h) => h.toUpperCase());
  const dateIdx = headerUpper.indexOf('DATE');
  const hourIdx = headerUpper.indexOf('HOUR');
  const hasHourColumn = hourIdx !== -1;

  if (dateIdx === -1) {
    return { valid: false, error: 'No Date column found', hasHourColumn };
  }

  if (rows.length === 0) {
    return { valid: true, hasHourColumn };
  }

  // Check if Date column has timestamps
  const sampleDate = rows[0][dateIdx];
  const dateHasTime = dateStringHasTime(sampleDate);

  if (!dateHasTime && !hasHourColumn) {
    return {
      valid: false,
      error: 'Date column must include timestamps (e.g. "2024-06-21 15:00:00") for hourly data. '
        + 'Alternatively, add an Hour column (0-23).',
      hasHourColumn,
    };
  }

  // Validate that the first row parses to a valid date
  let firstDt: Date;
  if (dateHasTime) {
    firstDt = new Date(sampleDate);
  } else if (hasHourColumn) {
    const hour = parseInt(rows[0][hourIdx], 10);
    if (isNaN(hour) || hour < 0 || hour > 23) {
      return {
        valid: false,
        error: `Row 2: Hour value "${rows[0][hourIdx]}" is not valid (expected 0-23)`,
        hasHourColumn,
      };
    }
    firstDt = new Date(`${sampleDate}T${String(hour).padStart(2, '0')}:00:00`);
  } else {
    firstDt = new Date(sampleDate);
  }

  if (isNaN(firstDt.getTime())) {
    return {
      valid: false,
      error: `Row 2: Cannot parse date "${sampleDate}"`,
      hasHourColumn,
    };
  }

  if (rows.length < 2) {
    return { valid: true, hasHourColumn };
  }

  // Parse first few datetimes and check for hourly gaps
  const sampleSize = Math.min(rows.length, 5);
  const datetimes: Date[] = [];

  for (let i = 0; i < sampleSize; i++) {
    const row = rows[i];
    let dt: Date;

    if (dateHasTime) {
      dt = new Date(row[dateIdx]);
    } else if (hasHourColumn) {
      const hour = parseInt(row[hourIdx], 10);
      if (isNaN(hour) || hour < 0 || hour > 23) {
        return {
          valid: false,
          error: `Row ${i + 2}: Hour value "${row[hourIdx]}" is not valid (expected 0-23)`,
          hasHourColumn,
        };
      }
      dt = new Date(`${row[dateIdx]}T${String(hour).padStart(2, '0')}:00:00`);
    } else {
      dt = new Date(row[dateIdx]);
    }

    if (isNaN(dt.getTime())) {
      return {
        valid: false,
        error: `Row ${i + 2}: Cannot parse date "${row[dateIdx]}"`,
        hasHourColumn,
      };
    }

    datetimes.push(dt);
  }

  // Check consecutive gaps
  for (let i = 1; i < datetimes.length; i++) {
    const hourDiff = (datetimes[i].getTime() - datetimes[i - 1].getTime()) / (1000 * 60 * 60);
    if (Math.abs(hourDiff - 1) > 0.1) {
      return {
        valid: false,
        error: `Rows ${i + 1}-${i + 2}: Expected 1-hour gap but found ${hourDiff} hours. `
          + (hourDiff === 0
            ? 'Date column may be missing timestamps — add time (e.g. "2024-06-21 15:00:00") or an Hour column.'
            : `Check that observations are hourly.`),
        hasHourColumn,
      };
    }
  }

  return { valid: true, hasHourColumn };
}

import type { ParsedWeatherCSV } from '../types';

/**
 * Constructs a ParsedWeatherCSV summary from parsed headers and rows.
 * Single source of truth used by all weather upload components so every
 * produced ParsedWeatherCSV carries the same fields (including dateRange).
 */
export function buildParsedWeatherCSV(
  headers: string[],
  rows: string[][],
): ParsedWeatherCSV {
  const headerSet = new Set(headers.map((h) => h.toUpperCase()));
  const hasFWIColumns = FWI_COLUMNS.every((col) => headerSet.has(col.toUpperCase()));
  const hasScenarioColumn = headerSet.has('SCENARIO');
  const dateRange = extractDateRange(headers, rows);
  const fwiValues = analyseFwiValues(headers, rows);

  return {
    headers,
    rowCount: rows.length,
    previewRows: rows.slice(0, 5),
    hasScenarioColumn,
    hasFWIColumns,
    ...(fwiValues ? { fwiValues } : {}),
    ...(dateRange ? { dateRange } : {}),
  };
}

/**
 * Extracts the min and max calendar date (YYYY-MM-DD) present in the Date
 * column of a parsed weather CSV. Accepts both bare dates ("2025-07-15") and
 * timestamps ("2025-07-15 13:00:00"), taking only the date prefix. Returns
 * undefined when no Date column is present or no valid dates are found.
 */
export function extractDateRange(
  headers: string[],
  rows: string[][],
): { minDate: string; maxDate: string } | undefined {
  const dateIndex = headers.findIndex((h) => h.trim().toLowerCase() === 'date');
  if (dateIndex === -1) return undefined;

  const dateRegex = /^\d{4}-\d{2}-\d{2}/;
  const dates: string[] = [];
  for (const row of rows) {
    const cell = row[dateIndex]?.trim();
    if (!cell) continue;
    const match = dateRegex.exec(cell);
    if (match) dates.push(match[0]);
  }

  if (dates.length === 0) return undefined;

  let minDate = dates[0];
  let maxDate = dates[0];
  for (const d of dates) {
    if (d < minDate) minDate = d;
    if (d > maxDate) maxDate = d;
  }
  return { minDate, maxDate };
}

/** The three codes FireSTARR takes from the series. A row without all three is unusable. */
const CORE_FWI_COLUMNS = ['FFMC', 'DMC', 'DC'];

/** What the FWI columns actually CONTAIN, as opposed to whether they exist. */
export interface FwiValueReport {
  totalRows: number;
  /** Rows carrying all three core codes as real numbers. */
  rowsWithAllCodes: number;
  /** Rows missing at least one of the three. */
  rowsMissingCodes: number;
  /** Count of absent values per FWI column, keyed by column name. */
  missingByColumn: Record<string, number>;
}

/**
 * Inspects the VALUES in the FWI columns — issue #357.
 *
 * hasFWIColumns only asks whether the headers are present. A file can carry
 * every column and still be unusable: vita's recorded its indices once a day,
 * so 253 of 264 rows held the text "NaN", and the upload step called it valid.
 *
 * Empty cells count as missing rather than as zero — parseFloat('') is NaN, and
 * a blank FFMC is not an FFMC of nought.
 *
 * Returns null when the file has no FWI columns at all; that is a raw weather
 * file and a different upload tab handles it.
 */
export function analyseFwiValues(
  headers: string[],
  rows: string[][],
): FwiValueReport | null {
  const upper = headers.map((h) => h.trim().toUpperCase());
  const present = FWI_COLUMNS.filter((col) => upper.includes(col));
  if (present.length === 0) return null;

  const missingByColumn: Record<string, number> = {};
  for (const col of present) missingByColumn[col] = 0;

  let rowsWithAllCodes = 0;

  for (const row of rows) {
    let coreComplete = true;

    for (const col of present) {
      const value = row[upper.indexOf(col)]?.trim() ?? '';
      const usable = value !== '' && Number.isFinite(Number(value));

      if (!usable) {
        missingByColumn[col] += 1;
        if (CORE_FWI_COLUMNS.includes(col)) coreComplete = false;
      }
    }

    if (coreComplete) rowsWithAllCodes += 1;
  }

  return {
    totalRows: rows.length,
    rowsWithAllCodes,
    rowsMissingCodes: rows.length - rowsWithAllCodes,
    missingByColumn,
  };
}
