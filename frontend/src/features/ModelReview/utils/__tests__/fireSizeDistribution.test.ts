import { describe, it, expect } from 'vitest';
import { ecdfPoints, histogramBins } from '../fireSizeDistribution';

describe('ecdfPoints', () => {
  it('rises to exactly 1 and starts above 0', () => {
    const pts = ecdfPoints([3, 1, 2]);
    expect(pts.map(p => p.sizeHa)).toEqual([1, 2, 3]);
    expect(pts.map(p => p.proportion)).toEqual([1 / 3, 2 / 3, 1]);
  });

  it('gives tied values the same cumulative proportion, counted once', () => {
    // 33 of 194 real size files hold a single repeated value, so ties are the
    // common case, not an edge case.
    const pts = ecdfPoints([5, 5, 9]);
    expect(pts).toEqual([
      { sizeHa: 5, proportion: 2 / 3 },
      { sizeHa: 9, proportion: 1 },
    ]);
  });

  it('returns a single point for a degenerate distribution', () => {
    expect(ecdfPoints([7, 7, 7])).toEqual([{ sizeHa: 7, proportion: 1 }]);
  });

  it('returns nothing for no data rather than a point at the origin', () => {
    expect(ecdfPoints([])).toEqual([]);
  });

  it('reads as a real ensemble: run c7ea0072 day 176', () => {
    const pts = ecdfPoints([209352, 227341]);
    expect(pts).toEqual([
      { sizeHa: 209352, proportion: 0.5 },
      { sizeHa: 227341, proportion: 1 },
    ]);
  });
});

describe('histogramBins', () => {
  it('covers the full range with equal-width bins and counts every value once', () => {
    const bins = histogramBins([1, 2, 3, 4]);
    expect(bins.length).toBeGreaterThan(0);
    expect(bins[0].fromHa).toBe(1);
    expect(bins[bins.length - 1].toHa).toBe(4);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(4);
  });

  it('puts the maximum in the LAST bin, not past the end', () => {
    // The classic off-by-one: a half-open final bin drops the maximum, so the
    // counts no longer sum to N and the tail of the distribution disappears —
    // which is the exact end a fire manager is asking about.
    const bins = histogramBins([1, 10]);
    expect(bins[bins.length - 1].count).toBeGreaterThanOrEqual(1);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(2);
  });

  it('returns ONE bin for a degenerate distribution instead of dividing by zero', () => {
    const bins = histogramBins([500, 500, 500]);
    expect(bins).toHaveLength(1);
    expect(bins[0]).toMatchObject({ fromHa: 500, toHa: 500, count: 3 });
  });

  it('returns no bins for no data', () => {
    expect(histogramBins([])).toEqual([]);
  });

  it('counts every value of a large real-shaped ensemble exactly once', () => {
    // 4134 rows from 1 to 3650 ha is a real run (eb8a2c5c).
    const sizes = Array.from({ length: 4134 }, (_, i) => 1 + (i % 3650));
    const bins = histogramBins(sizes);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(4134);
  });

  it('caps the bin count so a 4000-member ensemble does not render 4000 bars', () => {
    const sizes = Array.from({ length: 4134 }, (_, i) => 1 + (i % 3650));
    expect(histogramBins(sizes).length).toBeLessThanOrEqual(20);
  });
});
