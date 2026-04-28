/**
 * Tests for tileToMercatorBounds — refs #242 spatial bias fix.
 */

import { describe, it, expect } from 'vitest';
import {
  EARTH_CIRCUMFERENCE_M,
  MERCATOR_ORIGIN_M,
  tileToMercatorBounds,
} from '../webMercator.js';

describe('tileToMercatorBounds', () => {
  it('zoom 0 tile (0, 0) covers the entire Web Mercator extent', () => {
    const b = tileToMercatorBounds(0, 0, 0);
    expect(b.west).toBeCloseTo(-MERCATOR_ORIGIN_M, 4);
    expect(b.east).toBeCloseTo(MERCATOR_ORIGIN_M, 4);
    expect(b.north).toBeCloseTo(MERCATOR_ORIGIN_M, 4);
    expect(b.south).toBeCloseTo(-MERCATOR_ORIGIN_M, 4);
  });

  it('zoom 1 splits world into 4 equal tiles', () => {
    const ne = tileToMercatorBounds(1, 1, 0); // upper right quadrant
    expect(ne.west).toBeCloseTo(0, 4);
    expect(ne.east).toBeCloseTo(MERCATOR_ORIGIN_M, 4);
    expect(ne.north).toBeCloseTo(MERCATOR_ORIGIN_M, 4);
    expect(ne.south).toBeCloseTo(0, 4);
  });

  it('adjacent tiles share an edge exactly (no overlap, no gap)', () => {
    // Two horizontally adjacent tiles at the same z and y must share an X edge.
    const left = tileToMercatorBounds(8, 50, 100);
    const right = tileToMercatorBounds(8, 51, 100);
    expect(right.west).toBeCloseTo(left.east, 6);
    // And vertically — south edge of upper == north edge of lower.
    const upper = tileToMercatorBounds(8, 50, 100);
    const lower = tileToMercatorBounds(8, 50, 101);
    expect(lower.north).toBeCloseTo(upper.south, 6);
  });

  it('tile width at zoom z equals EARTH_CIRCUMFERENCE / 2^z', () => {
    const z = 12;
    const expectedWidth = EARTH_CIRCUMFERENCE_M / Math.pow(2, z);
    const b = tileToMercatorBounds(z, 1234, 567);
    expect(b.east - b.west).toBeCloseTo(expectedWidth, 4);
    expect(b.north - b.south).toBeCloseTo(expectedWidth, 4);
  });

  it('a tile near Den-Boychuk\'s test area (z=12, ~lat 55.4°N) covers ~10 km in 3857 metres', () => {
    // At z=12, tile width = ~40075km / 4096 ≈ 9786m. (Note: this is the
    // 3857 metric width — the *actual* ground distance varies with latitude
    // because Web Mercator is conformal but not equidistant.)
    const b = tileToMercatorBounds(12, 866, 1430);
    const widthM = b.east - b.west;
    expect(widthM).toBeGreaterThan(9700);
    expect(widthM).toBeLessThan(9900);
    // Sanity: this tile is in the northern hemisphere.
    expect(b.south).toBeGreaterThan(0);
  });
});
