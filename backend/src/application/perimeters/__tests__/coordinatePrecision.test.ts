import { describe, it, expect } from 'vitest';
import type { Polygon, MultiPolygon } from 'geojson';
import { roundCoord, roundPosition, roundPolygonCoordinates, COORD_PRECISION } from '../coordinatePrecision';

describe('coordinatePrecision', () => {
  it('rounds individual numbers to COORD_PRECISION decimals', () => {
    const result = roundCoord(-115.69234567891234567);
    expect(decimalsOf(result)).toBeLessThanOrEqual(COORD_PRECISION);
  });

  it('roundPosition preserves lon/lat and optional altitude with rounded precision', () => {
    const [lon, lat] = roundPosition([-115.123456789012345, 60.987654321098765]);
    expect(decimalsOf(lon)).toBeLessThanOrEqual(COORD_PRECISION);
    expect(decimalsOf(lat)).toBeLessThanOrEqual(COORD_PRECISION);
    const [, , alt] = roundPosition([1.1, 2.2, 3.333333333333333]);
    expect(decimalsOf(alt!)).toBeLessThanOrEqual(COORD_PRECISION);
  });

  it('roundPolygonCoordinates rounds every position in a Polygon in place', () => {
    const poly: Polygon = {
      type: 'Polygon',
      coordinates: [[
        [-115.123456789012345, 60.987654321098765],
        [-115.0, 60.0],
        [-115.123456789012345, 60.987654321098765],
      ]],
    };
    roundPolygonCoordinates(poly);
    for (const [lon, lat] of poly.coordinates[0]) {
      expect(decimalsOf(lon)).toBeLessThanOrEqual(COORD_PRECISION);
      expect(decimalsOf(lat)).toBeLessThanOrEqual(COORD_PRECISION);
    }
  });

  it('roundPolygonCoordinates rounds every position in a MultiPolygon in place', () => {
    const mp: MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [[
        [
          [-115.123456789012345, 60.987654321098765],
          [-114.0, 60.0],
          [-115.123456789012345, 60.987654321098765],
        ],
      ]],
    };
    roundPolygonCoordinates(mp);
    for (const part of mp.coordinates) {
      for (const ring of part) {
        for (const [lon, lat] of ring) {
          expect(decimalsOf(lon)).toBeLessThanOrEqual(COORD_PRECISION);
          expect(decimalsOf(lat)).toBeLessThanOrEqual(COORD_PRECISION);
        }
      }
    }
  });
});

function decimalsOf(n: number): number {
  const s = n.toString();
  const i = s.indexOf('.');
  return i === -1 ? 0 : s.length - i - 1;
}
