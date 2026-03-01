/**
 * Tests for dateFormat utility
 */

import { describe, it, expect } from 'vitest';
import { formatDateTime } from './dateFormat';

describe('formatDateTime', () => {
  it('returns empty string for empty input', () => {
    expect(formatDateTime('')).toBe('');
  });

  it('returns empty string for null-like empty date string', () => {
    expect(formatDateTime('', '00:00')).toBe('');
  });

  it('formats a date/time string using 24-hour clock', () => {
    // Use a fixed date that would differ between 12h and 24h
    const result = formatDateTime('2026-02-28', '14:30');
    // Should contain 14 (24h), not 2 PM (12h)
    expect(result).toContain('14');
    expect(result).not.toMatch(/2:30\s*PM/i);
    expect(result).not.toMatch(/2:30\s*pm/i);
  });

  it('formats midnight as 00:00 not 12:00 AM', () => {
    const result = formatDateTime('2026-02-28', '00:00');
    expect(result).toContain('00:00');
    expect(result).not.toMatch(/12:00\s*AM/i);
  });

  it('formats noon as 12:xx not 12:xx PM', () => {
    const result = formatDateTime('2026-02-28', '12:00');
    // Should not have AM/PM suffix
    expect(result).not.toMatch(/\s*(AM|PM)/i);
  });

  it('formats a date with only dateStr and no timeStr', () => {
    const result = formatDateTime('2026-02-28');
    // Should produce a valid formatted string
    expect(result).not.toBe('');
    expect(result).not.toMatch(/AM|PM/i);
  });

  it('returns empty string for invalid date', () => {
    const result = formatDateTime('not-a-date', '00:00');
    expect(result).toBe('');
  });

  it('includes day-of-week, month, day, year, hour, minute', () => {
    const result = formatDateTime('2026-02-28', '09:15');
    // 2026-02-28 is a Saturday
    expect(result).toMatch(/Sat/);
    expect(result).toMatch(/Feb/);
    expect(result).toMatch(/28/);
    expect(result).toMatch(/2026/);
    expect(result).toMatch(/09/);
    expect(result).toMatch(/15/);
  });
});
