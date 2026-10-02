/**
 * Weather-patch operation decoding (refs #294).
 *
 * The fgmj schema declares TWO enums called `Operation`, with different
 * numbering:
 *
 *   WeatherGridFilter.GridTypeOne.Operation  Equal 0 Plus 1 Minus 2 Multiply 3 Divide 4 Disable 5
 *   WeatherGridFilter.GridTypeTwo.Operation  Equal 0 Plus 1 Minus 2                      Disable 3
 *
 * GridTypeOne covers temperature, rh, precipitation and windSpeed.
 * GridTypeTwo covers windDirection, and only windDirection.
 *
 * So a raw `3` means Multiply on a temperature patch and Disable on a wind
 * direction patch. A parser that shares one enum across both reads one of them
 * wrong, and the run completes and looks plausible.
 *
 * No fixture catches this: every operation in all four sampled .fgmj files
 * happens to carry a number that means the same thing in both enums. Hence a
 * test derived from the schema rather than from sample data.
 */

import { describe, it, expect } from 'vitest';
import { decodeOperation, GridType } from '../weatherPatchOperations.js';

describe('decodeOperation', () => {
  describe('the two-enum trap', () => {
    it('reads 3 as Multiply for GridTypeOne fields', () => {
      expect(decodeOperation(3, GridType.One)).toBe('Multiply');
    });

    it('reads the same 3 as Disable for windDirection', () => {
      expect(decodeOperation(3, GridType.Two)).toBe('Disable');
    });

    it('reads 5 as Disable for GridTypeOne fields', () => {
      expect(decodeOperation(5, GridType.One)).toBe('Disable');
    });

    it('rejects 5 for windDirection — GridTypeTwo has no such value', () => {
      expect(() => decodeOperation(5, GridType.Two)).toThrow(/5/);
    });

    it('rejects 4 (Divide) for windDirection — GridTypeTwo has no Divide', () => {
      expect(() => decodeOperation(4, GridType.Two)).toThrow(/4/);
    });
  });

  describe('name form', () => {
    // Prometheus writes the operation as a string in the JSON form, so both
    // shapes have to decode.
    it('accepts the name directly when it is valid for that grid type', () => {
      expect(decodeOperation('Minus', GridType.One)).toBe('Minus');
      expect(decodeOperation('Minus', GridType.Two)).toBe('Minus');
      expect(decodeOperation('Divide', GridType.One)).toBe('Divide');
    });

    it('rejects a name that is not valid for that grid type', () => {
      expect(() => decodeOperation('Divide', GridType.Two)).toThrow(/Divide/);
      expect(() => decodeOperation('Multiply', GridType.Two)).toThrow(/Multiply/);
    });
  });

  describe('stop and alert, never a silent default', () => {
    it('throws on an unknown number, naming the value and the grid type', () => {
      expect(() => decodeOperation(99, GridType.One)).toThrow(/99/);
      expect(() => decodeOperation(99, GridType.One)).toThrow(/GridTypeOne/);
    });

    it('throws on an unknown name', () => {
      expect(() => decodeOperation('Frobnicate', GridType.One)).toThrow(/Frobnicate/);
    });

    it('throws rather than defaulting when the operation is missing', () => {
      expect(() => decodeOperation(undefined as unknown as number, GridType.One)).toThrow();
      expect(() => decodeOperation(null as unknown as number, GridType.One)).toThrow();
    });
  });

  describe('the numbering comes from the vendored schema, not a hand-copied table', () => {
    it('exposes the full GridTypeOne value set', () => {
      expect(decodeOperation(0, GridType.One)).toBe('Equal');
      expect(decodeOperation(1, GridType.One)).toBe('Plus');
      expect(decodeOperation(2, GridType.One)).toBe('Minus');
      expect(decodeOperation(4, GridType.One)).toBe('Divide');
    });

    it('exposes the full GridTypeTwo value set', () => {
      expect(decodeOperation(0, GridType.Two)).toBe('Equal');
      expect(decodeOperation(1, GridType.Two)).toBe('Plus');
      expect(decodeOperation(2, GridType.Two)).toBe('Minus');
    });
  });
});
