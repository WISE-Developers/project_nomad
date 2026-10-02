/**
 * MultiPolygon support for SpatialGeometry (refs #294 slice 2).
 *
 * Two merged ignitions become one MultiPolygon with two MEMBERS, not one
 * polygon with two rings — a second member flattened into a ring of the
 * first becomes a hole, which silently stops that fire burning. Each member
 * keeps its own ring list (exterior first, holes after).
 */

import { describe, it, expect } from 'vitest';
import {
  GeometryType,
  SpatialGeometry,
  type MultiPolygonCoordinates,
} from '../SpatialGeometry.js';
import { ValidationError } from '../../errors/index.js';

// Two disjoint 1x1 squares, far enough apart that they are obviously two
// members rather than one shape.
const SQUARE_A: MultiPolygonCoordinates = [
  [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
];
const SQUARE_B: MultiPolygonCoordinates = [
  [[[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]]],
];
const TWO_SQUARES: MultiPolygonCoordinates = [...SQUARE_A, ...SQUARE_B];

describe('SpatialGeometry — MultiPolygon', () => {
  it('constructs from valid members without throwing', () => {
    expect(
      () =>
        new SpatialGeometry({
          type: GeometryType.MultiPolygon,
          coordinates: TWO_SQUARES,
        }),
    ).not.toThrow();
  });

  it('isMultiPolygon() is true for MultiPolygon and false for other types', () => {
    const multi = new SpatialGeometry({
      type: GeometryType.MultiPolygon,
      coordinates: TWO_SQUARES,
    });
    expect(multi.isMultiPolygon()).toBe(true);

    const poly = new SpatialGeometry({
      type: GeometryType.Polygon,
      coordinates: SQUARE_A[0],
    });
    expect(poly.isMultiPolygon()).toBe(false);
  });

  describe('validation', () => {
    it('rejects a member ring with fewer than 4 positions', () => {
      const bad: MultiPolygonCoordinates = [
        [[[0, 0], [1, 0], [0, 0]]], // only 3 positions
      ];
      expect(
        () =>
          new SpatialGeometry({ type: GeometryType.MultiPolygon, coordinates: bad }),
      ).toThrow(ValidationError);
    });

    it('names which polygon member and which ring failed on a short ring', () => {
      const bad: MultiPolygonCoordinates = [
        SQUARE_A[0],
        [[[10, 10], [11, 10], [10, 10]]], // member 1, ring 0: too short
      ];
      try {
        new SpatialGeometry({ type: GeometryType.MultiPolygon, coordinates: bad });
        throw new Error('expected validation to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ValidationError);
        const message = (e as ValidationError).fieldErrors?.[0]?.message ?? '';
        expect(message).toMatch(/member 1/i);
        expect(message).toMatch(/ring 0/i);
      }
    });

    it('rejects a member ring that is not closed', () => {
      const bad: MultiPolygonCoordinates = [
        [[[0, 0], [1, 0], [1, 1], [0, 1]]], // not closed
      ];
      expect(
        () =>
          new SpatialGeometry({ type: GeometryType.MultiPolygon, coordinates: bad }),
      ).toThrow(ValidationError);
    });

    it('validates every member, not just the first', () => {
      const bad: MultiPolygonCoordinates = [
        SQUARE_A[0],
        [[[10, 10], [11, 10], [11, 11], [10, 11]]], // member 1 unclosed
      ];
      expect(
        () =>
          new SpatialGeometry({ type: GeometryType.MultiPolygon, coordinates: bad }),
      ).toThrow(ValidationError);
    });

    it('rejects an out-of-range position inside a hole of a later member', () => {
      const bad: MultiPolygonCoordinates = [
        SQUARE_A[0],
        [
          [[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]], // exterior
          [[10.2, 10.2], [999, 10.2], [10.8, 10.8], [10.2, 10.2]], // hole, bad lon
        ],
      ];
      expect(
        () =>
          new SpatialGeometry({ type: GeometryType.MultiPolygon, coordinates: bad }),
      ).toThrow(ValidationError);
    });
  });

  describe('getAllPositions / getBoundingBox', () => {
    it('includes positions from every member in the bounding box', () => {
      const multi = new SpatialGeometry({
        type: GeometryType.MultiPolygon,
        coordinates: TWO_SQUARES,
      });
      expect(multi.getBoundingBox()).toEqual([0, 0, 11, 11]);
    });
  });

  describe('getCentroid', () => {
    it('matches the single-polygon centroid for a MultiPolygon with one member', () => {
      const multi = new SpatialGeometry({
        type: GeometryType.MultiPolygon,
        coordinates: SQUARE_A,
      });
      const poly = new SpatialGeometry({
        type: GeometryType.Polygon,
        coordinates: SQUARE_A[0],
      });
      const [mx, my] = multi.getCentroid();
      const [px, py] = poly.getCentroid();
      expect(mx).toBeCloseTo(px, 10);
      expect(my).toBeCloseTo(py, 10);
      // Sanity: centroid of the unit square is (0.5, 0.5).
      expect(mx).toBeCloseTo(0.5, 10);
      expect(my).toBeCloseTo(0.5, 10);
    });

    it('is area-weighted, not an average of member centroids', () => {
      // A big 10x10 square and a tiny 1x1 square far away. A naive average
      // of the two member centroids would land roughly between them; the
      // correct area-weighted centroid lands almost entirely inside the big
      // square.
      const big: MultiPolygonCoordinates = [
        [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
      ];
      const small: MultiPolygonCoordinates = [
        [[[70, 70], [71, 70], [71, 71], [70, 71], [70, 70]]],
      ];
      const multi = new SpatialGeometry({
        type: GeometryType.MultiPolygon,
        coordinates: [...big, ...small],
      });
      const [cx, cy] = multi.getCentroid();
      // Naive average of centroids (5,5) and (70.5,70.5) would be
      // (37.75, 37.75) — nowhere close to this. Area-weighted must stay
      // near the big square.
      expect(cx).toBeLessThan(10);
      expect(cy).toBeLessThan(10);
    });

    it('falls back to a simple vertex average when total area is zero (degenerate)', () => {
      // Two degenerate (zero-area) "polygons" — collinear points repeated.
      const degenerate: MultiPolygonCoordinates = [
        [[[0, 0], [0, 0], [0, 0], [0, 0]]],
        [[[2, 2], [2, 2], [2, 2], [2, 2]]],
      ];
      const multi = new SpatialGeometry({
        type: GeometryType.MultiPolygon,
        coordinates: degenerate,
      });
      const [cx, cy] = multi.getCentroid();
      expect(cx).toBeCloseTo(1, 10);
      expect(cy).toBeCloseTo(1, 10);
    });
  });
});
