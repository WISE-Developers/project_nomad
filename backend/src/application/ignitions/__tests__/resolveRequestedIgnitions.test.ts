/**
 * Turning what a client asked for into one geometry the engine can burn
 * (refs #294).
 *
 * The run request used to carry exactly one ignition, and the frontend sent
 * `features[0]` — so a user who drew two shapes silently lost one. Now every
 * feature travels and more than one is merged here, through the same code the
 * .fgmj import uses.
 *
 * It also refuses an unknown geometry type BY NAME. The route used to build the
 * type with a ternary that had no else branch, so 'multipolygon', 'Point' with
 * a capital P, or any typo silently became Polygon and then failed somewhere
 * less obvious.
 */

import { describe, it, expect } from 'vitest';
import { GeometryType, type MultiPolygonCoordinates } from '../../../domain/entities/index.js';
import { resolveRequestedIgnitions } from '../resolveRequestedIgnitions.js';

const POINT = { type: 'point', coordinates: [-117, 60] };
const SQUARE = {
  type: 'polygon',
  coordinates: [[[-117, 60], [-116.9, 60], [-116.9, 60.1], [-117, 60.1], [-117, 60]]],
};
const LINE = { type: 'linestring', coordinates: [[-117, 60], [-116.9, 60]] };

describe('resolveRequestedIgnitions — a single ignition is untouched', () => {
  it('keeps a point a Point, with no notices', () => {
    const { geometry, notices } = resolveRequestedIgnitions([POINT]);
    expect(geometry.type).toBe(GeometryType.Point);
    expect(geometry.coordinates).toEqual([-117, 60]);
    expect(notices).toEqual([]);
  });

  it('keeps a polygon a Polygon, not wrapped in a MultiPolygon it does not need', () => {
    const { geometry, notices } = resolveRequestedIgnitions([SQUARE]);
    expect(geometry.type).toBe(GeometryType.Polygon);
    expect(notices).toEqual([]);
  });

  it('keeps a line a LineString — the rasterizer burns it by its own path', () => {
    const { geometry, notices } = resolveRequestedIgnitions([LINE]);
    expect(geometry.type).toBe(GeometryType.LineString);
    expect(notices).toEqual([]);
  });
});

describe('resolveRequestedIgnitions — more than one is merged', () => {
  it('merges two polygons into a two-member MultiPolygon', () => {
    const second = {
      type: 'polygon',
      coordinates: [[[-116, 60], [-115.9, 60], [-115.9, 60.1], [-116, 60.1], [-116, 60]]],
    };
    const { geometry } = resolveRequestedIgnitions([SQUARE, second]);
    expect(geometry.type).toBe(GeometryType.MultiPolygon);
    expect(geometry.coordinates as MultiPolygonCoordinates).toHaveLength(2);
  });

  it('tells the operator what it did to each one', () => {
    const { notices } = resolveRequestedIgnitions([SQUARE, POINT]);
    expect(notices).toHaveLength(2);
    expect(notices.join(' ')).toMatch(/circle/i);
    expect(notices.join(' ')).toContain('100 m');
  });

  it('names them positionally, since a drawn shape has no name', () => {
    const { notices } = resolveRequestedIgnitions([SQUARE, POINT]);
    expect(notices.join(' ')).toContain('ignition 1');
    expect(notices.join(' ')).toContain('ignition 2');
  });

  it('accommodates a line among them rather than refusing', () => {
    const { geometry, notices } = resolveRequestedIgnitions([SQUARE, LINE]);
    expect(geometry.type).toBe(GeometryType.MultiPolygon);
    expect(notices.join(' ')).toMatch(/corridor/i);
  });
});

describe('resolveRequestedIgnitions — refusals', () => {
  it('refuses an unknown geometry type by name instead of coercing it', () => {
    // This is the old ternary's silent fallthrough: anything that was not
    // 'point' or 'linestring' became Polygon.
    expect(() => resolveRequestedIgnitions([{ type: 'multipolygon', coordinates: [] }]))
      .toThrow(/multipolygon/i);
  });

  it('refuses a type that differs only in case, rather than guessing', () => {
    expect(() => resolveRequestedIgnitions([{ type: 'Point', coordinates: [-117, 60] }]))
      .toThrow(/Point/);
  });

  it('names the types it does accept when refusing', () => {
    let message = '';
    try {
      resolveRequestedIgnitions([{ type: 'blob', coordinates: [] }]);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('point');
    expect(message).toContain('polygon');
    expect(message).toContain('linestring');
  });

  it('refuses when no ignition was given at all', () => {
    expect(() => resolveRequestedIgnitions([])).toThrow(/at least one|no ignition/i);
  });
});
