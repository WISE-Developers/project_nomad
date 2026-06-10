/**
 * sldPalette — parse the vendored FireSTARR probability SLD
 * (gis/symbology/probability_processing.sld, pinned @93fc5aa) into a typed,
 * order-preserving ProbabilityPalette.
 *
 * Issue #283 / #190 / #270 — Unit 1. The probability legend must DERIVE from
 * the engine's authoritative SLD, never an invented constant. Fail-fast: a
 * missing or malformed SLD throws — there is no silent default ramp.
 *
 * Ground truth (read from the actual vendored bytes, 2026-06-10):
 *   type="intervals", 15 ColorMapEntry rows =
 *     2 transparent sentinels (opacity 0)  +
 *     10 visible probability ramp classes (q 0.1 -> 1.0, blue #00b1f2 -> red #e6151f) +
 *     3 status rows (q>1: Unprocessed #b7b7b7, Processing #ff00ff, Existing #64292a)
 *   quantities are 0-1 FRACTIONS, not percent.
 */

import { describe, it, expect } from 'vitest';
import { parseProbabilitySld } from '../sldPalette';
// Load the real vendored bytes through Vite's ?raw import (same path the
// production code will use), so the test validates the actual SLD on disk.
import VENDORED_SLD from '../probability_processing.sld?raw';

// Exact visible ramp, low (blue) -> high (red), as it appears in the SLD.
const RAMP_HEXES = [
  '#00b1f2', // 0.0 - 0.1  (low, blue)
  '#faf68e', // 0.1 - 0.2
  '#fcdf4b', // 0.2 - 0.3
  '#fac044', // 0.3 - 0.4
  '#f5a23d', // 0.4 - 0.5
  '#f28938', // 0.5 - 0.6
  '#f06c33', // 0.6 - 0.7
  '#ee4f2c', // 0.7 - 0.8
  '#eb3326', // 0.8 - 0.9
  '#e6151f', // > 0.9      (high, red)
];

describe('parseProbabilitySld', () => {
  describe('valid vendored SLD', () => {
    const palette = parseProbabilitySld(VENDORED_SLD);

    it('reports the ColorMap interval type (discrete, not interpolated)', () => {
      expect(palette.type).toBe('intervals');
    });

    it('parses all 15 ColorMapEntry rows in document order', () => {
      expect(palette.entries).toHaveLength(15);
      expect(palette.entries[0].label).toBe('Not simulated');
      expect(palette.entries[14].label).toBe('Existing');
    });

    it('extracts the 10 visible probability ramp classes, low -> high', () => {
      expect(palette.rampClasses.map((c) => c.color)).toEqual(RAMP_HEXES);
      expect(palette.rampClasses[0].label).toBe('0.0 - 0.1');
      expect(palette.rampClasses[9].label).toBe('> 0.9');
    });

    it('flags the 2 transparent sentinels and excludes them from the ramp', () => {
      expect(palette.sentinels).toHaveLength(2);
      expect(palette.sentinels.every((s) => s.opacity === 0)).toBe(true);
      // sentinels are not part of the visible ramp
      const rampColors = palette.rampClasses.map((c) => c.color);
      expect(rampColors).not.toContain('#ffffff');
    });

    it('captures the "Existing" already-burned overlay colour separately', () => {
      expect(palette.existing.color).toBe('#64292a');
      expect(palette.existing.label).toBe('Existing');
    });

    it('captures the WMS-import status rows (Unprocessed, Processing, Existing)', () => {
      expect(palette.importStatus.map((s) => s.label)).toEqual([
        'Unprocessed',
        'Processing',
        'Existing',
      ]);
      expect(palette.importStatus.map((s) => s.color)).toEqual([
        '#b7b7b7',
        '#ff00ff',
        '#64292a',
      ]);
    });

    it('keeps quantities as 0-1 fractions (does NOT rescale to percent)', () => {
      // low ramp class quantity is the fractional break, not 10 or 100
      expect(palette.rampClasses[0].quantity).toBeCloseTo(0.1, 5);
      expect(palette.rampClasses[9].quantity).toBeCloseTo(1.0, 5);
      expect(
        palette.rampClasses.every((c) => c.quantity <= 1.0000001),
      ).toBe(true);
    });
  });

  describe('fail-fast', () => {
    it('throws on an empty string (no silent default)', () => {
      expect(() => parseProbabilitySld('')).toThrow();
    });

    it('throws when there is no ColorMap element', () => {
      expect(() =>
        parseProbabilitySld('<root><nothing/></root>'),
      ).toThrow(/ColorMap/i);
    });

    it('throws on a malformed entry missing its colour', () => {
      const bad =
        '<ColorMap type="intervals">' +
        '<ColorMapEntry quantity="0.1" label="x"/>' +
        '</ColorMap>';
      expect(() => parseProbabilitySld(bad)).toThrow(/color/i);
    });
  });
});
