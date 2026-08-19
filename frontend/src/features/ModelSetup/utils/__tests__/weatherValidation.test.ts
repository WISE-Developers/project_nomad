/**
 * Weather CSV validation tests
 *
 * Covers #233: Weather input flagged as valid but isn't
 */

import { describe, it, expect } from 'vitest';
import {
  parseCSV,
  validateColumns,
  validateDatetimes,
  dateStringHasTime,
} from '../weatherValidation.js';

describe('dateStringHasTime', () => {
  it('returns true for datetime with space separator', () => {
    expect(dateStringHasTime('2024-06-21 15:00:00')).toBe(true);
  });

  it('returns true for datetime with T separator', () => {
    expect(dateStringHasTime('2024-06-21T15:00:00')).toBe(true);
  });

  it('returns true for datetime without seconds', () => {
    expect(dateStringHasTime('2024-06-21 15:00')).toBe(true);
  });

  it('returns true for single-digit hour (Samuel format)', () => {
    expect(dateStringHasTime('2025-05-12 1:00')).toBe(true);
  });

  it('returns false for date-only string', () => {
    expect(dateStringHasTime('2024-06-21')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(dateStringHasTime('')).toBe(false);
  });
});

describe('parseCSV', () => {
  it('parses headers and rows', () => {
    const csv = 'Date,TEMP,RH\n2024-06-21 13:00,25,40\n2024-06-21 14:00,26,38';
    const result = parseCSV(csv);
    expect(result.headers).toEqual(['Date', 'TEMP', 'RH']);
    expect(result.rows).toHaveLength(2);
  });

  it('skips empty lines', () => {
    const csv = 'Date,TEMP\n2024-06-21 13:00,25\n\n2024-06-21 14:00,26\n';
    const result = parseCSV(csv);
    expect(result.rows).toHaveLength(2);
  });
});

describe('validateColumns', () => {
  it('passes with all required columns', () => {
    const result = validateColumns(['Date', 'PREC', 'TEMP', 'RH', 'WS', 'WD']);
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it('passes with extra columns', () => {
    const result = validateColumns(['Date', 'PREC', 'TEMP', 'RH', 'WS', 'WD', 'Hour']);
    expect(result.valid).toBe(true);
  });

  it('is case-insensitive', () => {
    const result = validateColumns(['date', 'prec', 'temp', 'rh', 'ws', 'wd']);
    expect(result.valid).toBe(true);
  });

  it('reports missing columns', () => {
    const result = validateColumns(['Date', 'TEMP']);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('PREC');
  });
});

describe('validateDatetimes', () => {
  const headers = ['Date', 'PREC', 'TEMP', 'RH', 'WS', 'WD'];
  const headersWithHour = ['Date', 'Hour', 'PREC', 'TEMP', 'RH', 'WS', 'WD'];

  it('passes with proper hourly timestamps in Date column', () => {
    const rows = [
      ['2024-06-21 13:00:00', '0', '25', '40', '10', '270'],
      ['2024-06-21 14:00:00', '0', '26', '38', '12', '280'],
      ['2024-06-21 15:00:00', '0.5', '27', '35', '15', '275'],
    ];
    const result = validateDatetimes(headers, rows);
    expect(result.valid).toBe(true);
  });

  it('FAILS when Date has no timestamps and no Hour column (#233)', () => {
    const rows = [
      ['2024-06-21', '0', '25', '40', '10', '270'],
      ['2024-06-21', '0', '26', '38', '12', '280'],
      ['2024-06-21', '0.5', '27', '35', '15', '275'],
    ];
    const result = validateDatetimes(headers, rows);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('timestamps');
  });

  it('passes when Date has no timestamps but Hour column exists', () => {
    const rows = [
      ['2024-06-21', '13', '0', '25', '40', '10', '270'],
      ['2024-06-21', '14', '0', '26', '38', '12', '280'],
      ['2024-06-21', '15', '0.5', '27', '35', '15', '275'],
    ];
    const result = validateDatetimes(headersWithHour, rows);
    expect(result.valid).toBe(true);
    expect(result.hasHourColumn).toBe(true);
  });

  it('FAILS when Date+Hour produce non-hourly gaps', () => {
    const rows = [
      ['2024-06-21', '13', '0', '25', '40', '10', '270'],
      ['2024-06-21', '13', '0', '26', '38', '12', '280'], // same hour
    ];
    const result = validateDatetimes(headersWithHour, rows);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('0 hours');
  });

  it('FAILS with invalid Hour values', () => {
    const rows = [
      ['2024-06-21', '25', '0', '25', '40', '10', '270'], // hour > 23
    ];
    const result = validateDatetimes(headersWithHour, rows);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('not valid');
  });

  it('FAILS with unparseable date (no timestamp, no Hour column)', () => {
    const rows = [
      ['not-a-date', '0', '25', '40', '10', '270'],
    ];
    const result = validateDatetimes(headers, rows);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('timestamps');
  });

  it('FAILS with unparseable date when Hour column exists', () => {
    const rows = [
      ['not-a-date', '13', '0', '25', '40', '10', '270'],
    ];
    const result = validateDatetimes(headersWithHour, rows);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Cannot parse');
  });

  it('detects 0-hour gaps from identical timestamps', () => {
    const rows = [
      ['2024-06-21 13:00:00', '0', '25', '40', '10', '270'],
      ['2024-06-21 13:00:00', '0', '26', '38', '12', '280'], // same time
    ];
    const result = validateDatetimes(headers, rows);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('0 hours');
  });

  it('reports hasHourColumn correctly', () => {
    const rows = [['2024-06-21 13:00:00', '0', '25', '40', '10', '270']];
    expect(validateDatetimes(headers, rows).hasHourColumn).toBe(false);
    expect(validateDatetimes(headersWithHour, [['2024-06-21', '13', '0', '25', '40', '10', '270']]).hasHourColumn).toBe(true);
  });

  it('handles single row gracefully', () => {
    const rows = [['2024-06-21 13:00:00', '0', '25', '40', '10', '270']];
    const result = validateDatetimes(headers, rows);
    expect(result.valid).toBe(true);
  });
});

describe('extractDateRange', () => {
  it('returns min and max YYYY-MM-DD from Date column', async () => {
    const { extractDateRange } = await import('../weatherValidation.js');
    const headers = ['Date', 'Hour', 'FFMC', 'DMC', 'DC', 'ISI', 'BUI', 'FWI'];
    const rows = [
      ['2025-07-15', '0', '85', '30', '200', '5', '40', '10'],
      ['2025-07-15', '12', '88', '32', '210', '7', '42', '12'],
      ['2025-07-17', '6', '90', '35', '220', '8', '45', '14'],
      ['2025-07-16', '18', '87', '33', '215', '6', '43', '11'],
    ];

    expect(extractDateRange(headers, rows)).toEqual({
      minDate: '2025-07-15',
      maxDate: '2025-07-17',
    });
  });
});

describe('buildParsedWeatherCSV', () => {
  it('constructs ParsedWeatherCSV with dateRange, FWI flag, and scenario flag', async () => {
    const { buildParsedWeatherCSV } = await import('../weatherValidation.js');
    const headers = ['Scenario', 'Date', 'Hour', 'FFMC', 'DMC', 'DC', 'ISI', 'BUI', 'FWI'];
    const rows = [
      ['1', '2025-07-15', '0', '85', '30', '200', '5', '40', '10'],
      ['1', '2025-07-17', '12', '90', '35', '220', '8', '45', '14'],
    ];

    expect(buildParsedWeatherCSV(headers, rows)).toEqual({
      headers,
      rowCount: 2,
      previewRows: rows.slice(0, 5),
      hasScenarioColumn: true,
      hasFWIColumns: true,
      // #357: the summary now reports what the FWI columns hold, not just that
      // they exist. These rows are fully populated.
      fwiValues: {
        totalRows: 2,
        rowsWithAllCodes: 2,
        rowsMissingCodes: 0,
        missingByColumn: { FFMC: 0, DMC: 0, DC: 0, ISI: 0, BUI: 0, FWI: 0 },
      },
      dateRange: { minDate: '2025-07-15', maxDate: '2025-07-17' },
    });
  });

  it('omits dateRange and flags when data is sparse', async () => {
    const { buildParsedWeatherCSV } = await import('../weatherValidation.js');
    const headers = ['FFMC', 'DMC'];
    const rows = [['85', '30']];

    const result = buildParsedWeatherCSV(headers, rows);
    expect(result.hasScenarioColumn).toBe(false);
    expect(result.hasFWIColumns).toBe(false);
    expect(result.dateRange).toBeUndefined();
    expect(result.rowCount).toBe(1);
  });
});
