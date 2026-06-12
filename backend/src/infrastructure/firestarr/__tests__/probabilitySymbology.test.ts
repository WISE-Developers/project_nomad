/**
 * probabilitySymbology — the single backend authority for burn-probability
 * contour bands. Issue #283 / #270 / #190.
 *
 * Standardized on the FireSTARR SLD ramp (static symbology); the legacy
 * "dynamic"/quantile mode is dropped. Contours are "prob >= threshold" with
 * higher thresholds drawn on top, so each band's `threshold` is its LOWER
 * bound and the visible colour for that band fills [threshold, nextThreshold).
 *
 * The low band starts at MIN_PROBABILITY ("any burn probability > 0", per #270
 * / Den Boychuk) and is the SLD blue 0-10% class. This simultaneously fixes the
 * #270 0% trim AND the prior off-by-one (where blue was mislabeled "10%").
 * Colours/labels match the vendored SLD and the frontend palettes.ts legend.
 */

import { describe, it, expect } from 'vitest';
import {
  STATIC_PROBABILITY_BANDS,
  MIN_PROBABILITY,
} from '../probabilitySymbology.js';

const EXPECTED_COLORS = [
  '#00B1F2', // 0-10%  blue (low)
  '#FAF68E', // 10-20%
  '#FCDF4B', // 20-30%
  '#FAC044', // 30-40%
  '#F5A23D', // 40-50%
  '#F28938', // 50-60%
  '#F06C33', // 60-70%
  '#EE4F2C', // 70-80%
  '#EB3326', // 80-90%
  '#E6151F', // >90%   red (high)
];
const EXPECTED_LABELS = [
  '0-10%',
  '10-20%',
  '20-30%',
  '30-40%',
  '40-50%',
  '50-60%',
  '60-70%',
  '70-80%',
  '80-90%',
  '>90%',
];

describe('MIN_PROBABILITY', () => {
  it('is a small positive epsilon meaning "any probability > 0" (#270)', () => {
    expect(MIN_PROBABILITY).toBeGreaterThan(0);
    expect(MIN_PROBABILITY).toBeLessThan(0.001);
  });
});

describe('STATIC_PROBABILITY_BANDS', () => {
  it('has the 10 SLD classes, low -> high', () => {
    expect(STATIC_PROBABILITY_BANDS).toHaveLength(10);
  });

  it('low band captures any prob > 0 as the blue 0-10% class (#270 + off-by-one)', () => {
    const low = STATIC_PROBABILITY_BANDS[0];
    expect(low.threshold).toBe(MIN_PROBABILITY);
    expect(low.threshold).toBeGreaterThan(0);
    expect(low.threshold).toBeLessThan(0.1);
    expect(low.color).toBe('#00B1F2');
    expect(low.label).toBe('0-10%');
  });

  it('high band is the red >90% class at threshold 0.9', () => {
    const high = STATIC_PROBABILITY_BANDS[9];
    expect(high.threshold).toBe(0.9);
    expect(high.color).toBe('#E6151F');
    expect(high.label).toBe('>90%');
  });

  it('colours match the SLD ramp in order', () => {
    expect(STATIC_PROBABILITY_BANDS.map((b) => b.color)).toEqual(EXPECTED_COLORS);
  });

  it('labels are SLD percent bands in order', () => {
    expect(STATIC_PROBABILITY_BANDS.map((b) => b.label)).toEqual(EXPECTED_LABELS);
  });

  it('thresholds are strictly ascending (so masks nest correctly)', () => {
    const t = STATIC_PROBABILITY_BANDS.map((b) => b.threshold);
    for (let i = 1; i < t.length; i++) {
      expect(t[i]).toBeGreaterThan(t[i - 1]);
    }
    // bands 1..9 sit on the 0.1..0.9 decile breaks
    expect(t.slice(1)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]);
  });

  it('carries no legacy ramp colours (no green low, no quantile YlOrRd)', () => {
    const colors = STATIC_PROBABILITY_BANDS.map((b) => b.color.toLowerCase());
    expect(colors).not.toContain('#4caf50'); // old green 0-10%
    expect(colors).not.toContain('#ffffcc'); // quantile lightest
    expect(colors).not.toContain('#b10026'); // quantile darkest
  });
});
