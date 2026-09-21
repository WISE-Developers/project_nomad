/**
 * Tests for log-line timestamps — issue #371.
 *
 * Log timestamps are what people reach for when reconstructing what happened
 * during an incident, often months later and often alongside records from
 * other systems. An hour of ambiguity there is an hour spent arguing about
 * whether two events were simultaneous.
 *
 * The header of logger.ts states the intent plainly -- "Local datetime
 * timestamps (not UTC)" -- but the container runs UTC, so what was emitted
 * was UTC wearing no label at all. Either answer is defensible; being
 * silent about which one is not.
 */

import { describe, it, expect } from 'vitest';
import { formatLogTimestamp } from '../logTimestamp.js';

const INSTANT = new Date('2026-07-15T18:30:45.123Z');

describe('formatLogTimestamp', () => {
  it('always states the offset', () => {
    // Without this a reader cannot place the line against any other record.
    expect(formatLogTimestamp(INSTANT, 'America/Edmonton')).toMatch(/[+-]\d{2}:\d{2}$/);
  });

  it('renders in the zone it is given', () => {
    // 18:30:45.123Z is 12:30:45.123 in Edmonton (MDT, UTC-6) on this date.
    expect(formatLogTimestamp(INSTANT, 'America/Edmonton')).toBe(
      '2026-07-15 12:30:45.123 -06:00',
    );
  });

  it('renders UTC as +00:00 rather than leaving it implied', () => {
    expect(formatLogTimestamp(INSTANT, 'UTC')).toBe('2026-07-15 18:30:45.123 +00:00');
  });

  it('keeps millisecond precision', () => {
    expect(formatLogTimestamp(INSTANT, 'UTC')).toContain('.123');
  });

  it('never throws, whatever the zone', () => {
    // Logging must not be the thing that takes the process down. A bad zone
    // degrades to a labelled UTC line rather than losing the log entry.
    expect(() => formatLogTimestamp(INSTANT, 'Not/A_Zone')).not.toThrow();
    expect(formatLogTimestamp(INSTANT, 'Not/A_Zone')).toMatch(/[+-]\d{2}:\d{2}$/);
  });
});
