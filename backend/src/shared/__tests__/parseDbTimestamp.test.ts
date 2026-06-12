/**
 * Tests for parseDbTimestamp — tolerant timestamp parser for DB row values.
 *
 * Accepts both ISO-8601-with-offset (what app code writes via toISOString)
 * and bare SQL timestamps (what SQLite's CURRENT_TIMESTAMP and Knex's
 * knex.fn.now() produce, always in UTC).
 *
 * Refs #273 (TZ double-adjust hardening).
 */

import { describe, it, expect } from 'vitest';
import { parseDbTimestamp } from '../dateParsing.js';

describe('parseDbTimestamp', () => {
  it('parses ISO-8601 with Z', () => {
    const d = parseDbTimestamp('2026-05-31T22:00:00.000Z', 'created_at');
    expect(d.toISOString()).toBe('2026-05-31T22:00:00.000Z');
  });

  it('parses ISO-8601 with offset', () => {
    const d = parseDbTimestamp('2026-05-31T15:00:00-07:00', 'created_at');
    expect(d.toISOString()).toBe('2026-05-31T22:00:00.000Z');
  });

  it('parses bare SQL timestamp as UTC (SQLite CURRENT_TIMESTAMP shape)', () => {
    const d = parseDbTimestamp('2026-05-31 22:00:00', 'created_at');
    expect(d.toISOString()).toBe('2026-05-31T22:00:00.000Z');
  });

  it('parses ISO without offset as UTC fallback', () => {
    const d = parseDbTimestamp('2026-05-31T22:00:00', 'created_at');
    expect(d.toISOString()).toBe('2026-05-31T22:00:00.000Z');
  });

  it('throws on empty string', () => {
    expect(() => parseDbTimestamp('', 'created_at')).toThrow(/created_at/);
  });

  it('throws on garbage', () => {
    expect(() => parseDbTimestamp('not a timestamp', 'created_at')).toThrow(/created_at/);
  });
});
