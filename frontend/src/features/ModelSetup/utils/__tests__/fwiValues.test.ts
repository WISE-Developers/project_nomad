/**
 * FWI value inspection — issue #357.
 *
 * The upload step reported "Valid FireSTARR weather file — 264 hourly records
 * with all required columns including FWI indices" for a file whose indices
 * were NaN on all but one row per day. It checked that the COLUMNS existed,
 * never that they held numbers. vita uploaded six times over a week and was
 * told each time that her file was good.
 */

import { describe, it, expect } from 'vitest';
import { analyseFwiValues } from '../weatherValidation.js';

const HEADERS = ['Scenario', 'Date', 'PREC', 'TEMP', 'RH', 'WS', 'WD', 'FFMC', 'DMC', 'DC', 'ISI', 'BUI', 'FWI'];

function row(stamp: string, codes: string[]): string[] {
  return ['0', stamp, '0', '20', '45', '10', '180', ...codes];
}

const POPULATED = ['84.65', '20.72', '424.9', '2', '34.44', '4.64'];
const NAN_TEXT = ['NaN', 'NaN', 'NaN', 'NaN', 'NaN', 'NaN'];
const EMPTY = ['', '', '', '', '', ''];

describe('analyseFwiValues', () => {
  it('reports a fully populated file as complete', () => {
    const report = analyseFwiValues(HEADERS, [
      row('2026-08-01 00:00:00', POPULATED),
      row('2026-08-01 01:00:00', POPULATED),
    ]);

    expect(report!.rowsMissingCodes).toBe(0);
    expect(report!.rowsWithAllCodes).toBe(2);
  });

  it('counts rows whose codes are the literal text NaN', () => {
    const report = analyseFwiValues(HEADERS, [
      row('2026-08-01 00:00:00', NAN_TEXT),
      row('2026-08-01 19:00:00', POPULATED),
      row('2026-08-01 20:00:00', NAN_TEXT),
    ]);

    expect(report!.totalRows).toBe(3);
    expect(report!.rowsMissingCodes).toBe(2);
    expect(report!.rowsWithAllCodes).toBe(1);
  });

  it('counts empty cells as missing, not as zero', () => {
    // parseFloat('') is NaN, and a blank FFMC is not an FFMC of 0.
    const report = analyseFwiValues(HEADERS, [
      row('2026-08-01 00:00:00', EMPTY),
      row('2026-08-01 19:00:00', POPULATED),
    ]);

    expect(report!.rowsMissingCodes).toBe(1);
  });

  it('names which columns are missing values, and how many', () => {
    const report = analyseFwiValues(HEADERS, [
      row('2026-08-01 00:00:00', ['84.65', '', '', '2', '34.44', '4.64']),
      row('2026-08-01 01:00:00', ['84.65', '', '', '2', '34.44', '4.64']),
    ]);

    expect(report!.missingByColumn.DMC).toBe(2);
    expect(report!.missingByColumn.DC).toBe(2);
    expect(report!.missingByColumn.FFMC).toBe(0);
  });

  it('treats a row as missing when ANY of the three core codes is absent', () => {
    // FFMC alone is not a usable set. FireSTARR needs all three.
    const report = analyseFwiValues(HEADERS, [row('2026-08-01 00:00:00', ['84.65', 'NaN', 'NaN', '2', '34.44', '4.64'])]);

    expect(report!.rowsMissingCodes).toBe(1);
  });

  it('returns null when the file has no FWI columns at all', () => {
    // A raw weather file. Nothing to inspect; a different upload tab handles it.
    const rawHeaders = ['Date', 'PREC', 'TEMP', 'RH', 'WS', 'WD'];
    expect(analyseFwiValues(rawHeaders, [['2026-08-01 00:00:00', '0', '20', '45', '10', '180']])).toBeNull();
  });

  it("measures vita's shape: one populated row per day", () => {
    const rows = [];
    for (let hour = 0; hour < 24; hour++) {
      rows.push(row(`2026-08-01 ${String(hour).padStart(2, '0')}:06:00`, hour === 19 ? POPULATED : NAN_TEXT));
    }

    const report = analyseFwiValues(HEADERS, rows);
    expect(report!.rowsMissingCodes).toBe(23);
    expect(report!.rowsWithAllCodes).toBe(1);
  });
});
