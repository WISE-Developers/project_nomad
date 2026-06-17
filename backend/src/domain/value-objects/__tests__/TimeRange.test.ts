/**
 * Characterization tests for TimeRange (Phase-2 remediation item 6).
 *
 * Pins current behavior of fromISO() + constructor validation BEFORE relocating
 * the ISO parser (parseIsoToDate) out of shared/ into the domain layer. The
 * relocation is type/location-only; these tests must stay green unchanged.
 */

import { describe, it, expect } from 'vitest';
import { TimeRange } from '../TimeRange.js';
import { ValidationError } from '../../errors/index.js';

describe('TimeRange.fromISO (characterization)', () => {
  it('builds a range from valid offset-bearing ISO strings', () => {
    const tr = TimeRange.fromISO('2026-06-01T00:00:00Z', '2026-06-02T00:00:00Z');
    expect(tr.start.getTime()).toBe(new Date('2026-06-01T00:00:00Z').getTime());
    expect(tr.end.getTime()).toBe(new Date('2026-06-02T00:00:00Z').getTime());
    expect(tr.getDurationHours()).toBe(24);
  });

  it('throws "Invalid start date" for an unparseable start', () => {
    expect(() => TimeRange.fromISO('not-a-date', '2026-06-02T00:00:00Z')).toThrow(
      'Invalid start date'
    );
  });

  it('throws "Invalid end date" for an unparseable end', () => {
    expect(() => TimeRange.fromISO('2026-06-01T00:00:00Z', 'not-a-date')).toThrow(
      'Invalid end date'
    );
  });
});

describe('TimeRange constructor validation (characterization)', () => {
  it('throws ValidationError when end is not after start', () => {
    const start = new Date('2026-06-02T00:00:00Z');
    const end = new Date('2026-06-01T00:00:00Z');
    expect(() => new TimeRange(start, end)).toThrow(ValidationError);
  });

  it('throws ValidationError for an invalid Date', () => {
    expect(() => new TimeRange(new Date('invalid'), new Date('2026-06-02T00:00:00Z'))).toThrow(
      ValidationError
    );
  });
});
