/**
 * Tests for useRasterHover hook — colorToPercentage function
 *
 * Verifies the FireSTARR burn-probability colour ramp mapping from RGB values
 * to band label strings. The ramp is sourced from the vendored SLD via
 * symbology/palettes (#283) — blue low (#00B1F2 → "0-10%") to red high
 * (#E6151F → ">90%"). The function returns a label string or null, never a
 * number.
 *
 * @module features/Map/hooks/__tests__
 */

import { describe, it, expect } from 'vitest';
import { colorToPercentage } from './useRasterHover.js';

// =============================================================================
// SLD ramp anchor points (rgb → label), high → low
// =============================================================================
// (230,  21,  31) #E6151F → '>90%'
// (235,  51,  38) #EB3326 → '80-90%'
// (238,  79,  44) #EE4F2C → '70-80%'
// (240, 108,  51) #F06C33 → '60-70%'
// (242, 137,  56) #F28938 → '50-60%'
// (245, 162,  61) #F5A23D → '40-50%'
// (250, 192,  68) #FAC044 → '30-40%'
// (252, 223,  75) #FCDF4B → '20-30%'
// (250, 246, 142) #FAF68E → '10-20%'
// (  0, 177, 242) #00B1F2 → '0-10%'  (blue low — any prob > 0, #270)

describe('colorToPercentage', () => {
  describe('exact anchor points', () => {
    it("maps red high (230, 21, 31) to '>90%'", () => {
      expect(colorToPercentage(230, 21, 31)).toBe('>90%');
    });

    it("maps dark red (235, 51, 38) to '80-90%'", () => {
      expect(colorToPercentage(235, 51, 38)).toBe('80-90%');
    });

    it("maps red (238, 79, 44) to '70-80%'", () => {
      expect(colorToPercentage(238, 79, 44)).toBe('70-80%');
    });

    it("maps red-orange (240, 108, 51) to '60-70%'", () => {
      expect(colorToPercentage(240, 108, 51)).toBe('60-70%');
    });

    it("maps dark orange (242, 137, 56) to '50-60%'", () => {
      expect(colorToPercentage(242, 137, 56)).toBe('50-60%');
    });

    it("maps orange (245, 162, 61) to '40-50%'", () => {
      expect(colorToPercentage(245, 162, 61)).toBe('40-50%');
    });

    it("maps light orange (250, 192, 68) to '30-40%'", () => {
      expect(colorToPercentage(250, 192, 68)).toBe('30-40%');
    });

    it("maps yellow (252, 223, 75) to '20-30%'", () => {
      expect(colorToPercentage(252, 223, 75)).toBe('20-30%');
    });

    it("maps light yellow (250, 246, 142) to '10-20%'", () => {
      expect(colorToPercentage(250, 246, 142)).toBe('10-20%');
    });

    it("maps blue low (0, 177, 242) to '0-10%' (SLD low class, #270)", () => {
      expect(colorToPercentage(0, 177, 242)).toBe('0-10%');
    });
  });

  describe('nearest-band matching (discrete classes)', () => {
    it('maps a colour close to the >90% anchor to that band', () => {
      // Slight deviation from anchor (230, 21, 31) → still closest to it
      expect(colorToPercentage(228, 25, 33)).toBe('>90%');
    });

    it('maps a colour close to the 80-90% anchor to that band', () => {
      // Slight deviation from anchor (235, 51, 38)
      expect(colorToPercentage(233, 55, 40)).toBe('80-90%');
    });

    it('maps a colour close to the blue 0-10% anchor to that band', () => {
      // Slight deviation from anchor (0, 177, 242)
      expect(colorToPercentage(3, 174, 239)).toBe('0-10%');
    });
  });

  describe('alpha channel handling', () => {
    it('accepts an optional alpha parameter and returns same result as without it', () => {
      expect(colorToPercentage(230, 21, 31, 255)).toBe(colorToPercentage(230, 21, 31));
    });

    it('returns null for fully transparent pixels (alpha = 0)', () => {
      expect(colorToPercentage(230, 21, 31, 0)).toBeNull();
    });
  });

  describe('unknown / background colors', () => {
    it('returns null for pure black (background / no-data)', () => {
      expect(colorToPercentage(0, 0, 0)).toBeNull();
    });

    it('returns null for pure white', () => {
      expect(colorToPercentage(255, 255, 255)).toBeNull();
    });

    it('returns null for pure blue, far from the cyan-blue low class', () => {
      // (0,0,255) is ~177 units from the SLD low anchor (0,177,242) → rejected
      expect(colorToPercentage(0, 0, 255)).toBeNull();
    });
  });

  describe('return value format', () => {
    it('returns a string for a valid ramp colour', () => {
      const result = colorToPercentage(230, 21, 31);
      expect(typeof result).toBe('string');
    });

    it('returns a band label string (percent range or open-ended top)', () => {
      expect(colorToPercentage(245, 162, 61)).toMatch(/^(\d+-\d+%|>\d+%)$/);
    });
  });
});
