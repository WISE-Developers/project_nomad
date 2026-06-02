/**
 * Tests for parseIsoToDate — strict ISO-8601 string → Date parser.
 *
 * Centralizes ISO parsing so `new Date(string)` is no longer scattered through
 * the codebase. Validates input and fails loudly on bad strings rather than
 * silently producing `Invalid Date` (which downstream code happily passes on).
 *
 * Refs #273 (TZ double-adjust hardening).
 */

import { describe, it, expect } from 'vitest';
import { parseIsoToDate } from '../dateParsing.js';

describe('parseIsoToDate', () => {
  it('parses an ISO-8601 string with UTC offset', () => {
    const d = parseIsoToDate('2026-05-31T22:00:00Z', 'test');
    expect(d.toISOString()).toBe('2026-05-31T22:00:00.000Z');
  });

  it('parses an ISO-8601 string with an explicit offset', () => {
    const d = parseIsoToDate('2026-05-31T22:00:00-07:00', 'test');
    // 22:00 PDT == 05:00 UTC next day
    expect(d.toISOString()).toBe('2026-06-01T05:00:00.000Z');
  });

  it('throws on an empty string', () => {
    expect(() => parseIsoToDate('', 'fieldX')).toThrow(/fieldX/);
  });

  it('throws on a non-ISO garbage string', () => {
    expect(() => parseIsoToDate('not a date', 'fieldX')).toThrow(/fieldX/);
  });

  it('throws on a bare timestamp with no offset (no silent local interp)', () => {
    // Bare timestamps are TZ-ambiguous; reject them here. Callers that know
    // the zone must use a TZ-aware parser (Luxon fromSQL/fromFormat with zone).
    expect(() => parseIsoToDate('2026-05-31 22:00:00', 'fieldX')).toThrow(/fieldX/);
  });

  it('includes the context label in the error message for debuggability', () => {
    expect(() => parseIsoToDate('garbage', 'WeatherCSV.firstRow.datetime')).toThrow(
      /WeatherCSV\.firstRow\.datetime/,
    );
  });
});
