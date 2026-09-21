/**
 * Tests for the exported-capture timestamp — issue #369.
 *
 * The map capture burns a timestamp into the PNG/PDF metadata strip. That
 * artifact then leaves the application: it is shared with an incident team,
 * attached to a report, printed. Whoever reads it later cannot ask the app
 * which zone the number meant.
 *
 * A bare local time is therefore not merely ambiguous, it is unrecoverable.
 * The zone has to travel with the value.
 */

import { describe, it, expect } from 'vitest';
import { formatCaptureTimestamp } from '../captureTimestamp.js';

const INSTANT = new Date('2026-07-15T18:30:00Z');

describe('formatCaptureTimestamp', () => {
  it('always carries a timezone label', () => {
    const formatted = formatCaptureTimestamp(INSTANT, 'America/Edmonton');
    expect(formatted).toMatch(/MDT|MST|CST|GMT[+-]\d/);
  });

  it('renders in the zone it is given, not the process zone', () => {
    // 18:30Z is 12:30 in Edmonton (MDT, UTC-6) on this date.
    expect(formatCaptureTimestamp(INSTANT, 'America/Edmonton')).toMatch(/12:30/);
    // ...and 14:30 in Toronto (EDT, UTC-4) at the same instant.
    expect(formatCaptureTimestamp(INSTANT, 'America/Toronto')).toMatch(/14:30/);
  });

  it('still labels the zone when none is given', () => {
    // Falling back to the viewer's own zone is acceptable — silently
    // omitting which zone that was is not.
    const formatted = formatCaptureTimestamp(INSTANT);
    expect(formatted).toMatch(/[A-Z]{2,5}|GMT[+-]\d/);
  });

  it('does not throw on an unusable zone, so a capture is never lost', () => {
    // The artifact matters more than the label. A bad zone should degrade
    // to something readable rather than abort the export.
    expect(() => formatCaptureTimestamp(INSTANT, 'Not/A_Zone')).not.toThrow();
    expect(formatCaptureTimestamp(INSTANT, 'Not/A_Zone')).toBeTruthy();
  });
});
