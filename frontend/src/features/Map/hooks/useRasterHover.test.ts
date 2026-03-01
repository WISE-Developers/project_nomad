/**
 * Tests for useRasterHover hook — colorToPercentage function
 *
 * Verifies the FireSTARR color ramp mapping from RGB values to burn probability
 * percentages, including exact anchor points, interpolation, and edge cases.
 *
 * @module features/Map/hooks/__tests__
 */

import { describe, it, expect } from 'vitest';
import { colorToPercentage } from './useRasterHover.js';

// =============================================================================
// FireSTARR Color Ramp Anchor Points
// =============================================================================
// 90% = red        (255, 0,   0)
// 75% = orange     (255, 165, 0)
// 50% = yellow     (255, 255, 0)
// 25% = yellow-green (173, 255, 47)
// 10% = green      (0,   255, 0)

describe('colorToPercentage', () => {
  describe('exact anchor points', () => {
    it('maps red (255, 0, 0) to 90%', () => {
      expect(colorToPercentage(255, 0, 0)).toBe(90);
    });

    it('maps orange (255, 165, 0) to 75%', () => {
      expect(colorToPercentage(255, 165, 0)).toBe(75);
    });

    it('maps yellow (255, 255, 0) to 50%', () => {
      expect(colorToPercentage(255, 255, 0)).toBe(50);
    });

    it('maps yellow-green (173, 255, 47) to 25%', () => {
      expect(colorToPercentage(173, 255, 47)).toBe(25);
    });

    it('maps green (0, 255, 0) to 10%', () => {
      expect(colorToPercentage(0, 255, 0)).toBe(10);
    });
  });

  describe('interpolation between anchors', () => {
    it('returns a value between 75 and 90 for colors between red and orange', () => {
      // midpoint between red (255,0,0) and orange (255,165,0) => (255,82,0)
      const result = colorToPercentage(255, 82, 0);
      expect(result).toBeGreaterThan(75);
      expect(result).toBeLessThan(90);
    });

    it('returns a value between 50 and 75 for colors between orange and yellow', () => {
      // midpoint between orange (255,165,0) and yellow (255,255,0) => (255,210,0)
      const result = colorToPercentage(255, 210, 0);
      expect(result).toBeGreaterThan(50);
      expect(result).toBeLessThan(75);
    });

    it('returns a value between 25 and 50 for colors between yellow and yellow-green', () => {
      // midpoint between yellow (255,255,0) and yellow-green (173,255,47) => (214,255,23)
      const result = colorToPercentage(214, 255, 23);
      expect(result).toBeGreaterThan(25);
      expect(result).toBeLessThan(50);
    });

    it('returns a value between 10 and 25 for colors between yellow-green and green', () => {
      // midpoint between yellow-green (173,255,47) and green (0,255,0) => (86,255,23)
      const result = colorToPercentage(86, 255, 23);
      expect(result).toBeGreaterThan(10);
      expect(result).toBeLessThan(25);
    });
  });

  describe('alpha channel handling', () => {
    it('accepts an optional alpha parameter and returns same result as without it', () => {
      expect(colorToPercentage(255, 0, 0, 255)).toBe(colorToPercentage(255, 0, 0));
    });

    it('returns null for fully transparent pixels (alpha = 0)', () => {
      expect(colorToPercentage(255, 0, 0, 0)).toBeNull();
    });
  });

  describe('unknown / background colors', () => {
    it('returns null for pure black (background / no-data)', () => {
      expect(colorToPercentage(0, 0, 0)).toBeNull();
    });

    it('returns null for pure white', () => {
      expect(colorToPercentage(255, 255, 255)).toBeNull();
    });

    it('returns null for an arbitrary color far from the ramp', () => {
      expect(colorToPercentage(0, 0, 255)).toBeNull();
    });
  });

  describe('return value format', () => {
    it('returns an integer percentage for exact anchor colors', () => {
      const result = colorToPercentage(255, 0, 0);
      expect(result).toBe(Math.round(result as number));
    });

    it('returns a number in the range 10-90 for valid ramp colors', () => {
      const result = colorToPercentage(255, 165, 0);
      expect(result).toBeGreaterThanOrEqual(10);
      expect(result).toBeLessThanOrEqual(90);
    });
  });
});
