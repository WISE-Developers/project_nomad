/**
 * Can this layer actually draw at the view we are looking at? (#448)
 *
 * A WMS server asked for a layer outside its declared scale range answers with
 * an EMPTY IMAGE and a 200. Nothing fails, nothing warns, the map stays blank —
 * indistinguishable from a layer that worked.
 *
 * Measured on the live CIFFC demo, 2026-10-16. BC's *Forest Licensee Operating
 * Areas* declares `<MaxScaleDenominator>6000000</MaxScaleDenominator>`; the view
 * was at roughly 1:35,000,000. Capabilities 200, legend 200, nineteen GetMap
 * tiles all 200, map empty. Same bbox and CRS at 1024px returned 24,007 bytes of
 * real content, which is what proved the layer was fine and the SCALE was wrong.
 *
 * THE POINT IS THE EXPLANATION, NOT THE DETECTION. Sampling tiles for
 * transparent pixels would also notice something was wrong; only the declared
 * range can say *why* and *what to do* — and it can say so before a single tile
 * is requested.
 *
 * ABSENT IS NOT A LIMIT. A layer declaring no range is unconstrained, and must
 * never be reported as out of range. That is the same distinction the
 * capabilities parser keeps: "we do not know" is not "zero".
 */
import { describe, it, expect } from 'vitest';
import { scaleDenominatorFor, assessScaleVisibility } from '../scaleVisibility.js';

describe('scaleDenominatorFor', () => {
  it('falls as you zoom in — each level roughly halves the denominator', () => {
    const z4 = scaleDenominatorFor(4, 55);
    const z5 = scaleDenominatorFor(5, 55);
    expect(z5).toBeLessThan(z4);
    expect(z4 / z5).toBeCloseTo(2, 1);
  });

  it('matches the view that produced the live failure, to an order of magnitude', () => {
    // zoom 4.3 at ~55°N over Canada. The layer's limit is 1:6,000,000, and the
    // whole point is that this view is far coarser than that.
    const denominator = scaleDenominatorFor(4.3, 55);
    expect(denominator).toBeGreaterThan(6_000_000);
    expect(denominator).toBeGreaterThan(10_000_000);
    expect(denominator).toBeLessThan(100_000_000);
  });

  it('accounts for latitude — the same zoom is a finer scale further north', () => {
    expect(scaleDenominatorFor(6, 60)).toBeLessThan(scaleDenominatorFor(6, 0));
  });
});

describe('assessScaleVisibility', () => {
  const AT_THE_LIVE_VIEW = scaleDenominatorFor(4.3, 55);

  it('reports VISIBLE when the layer declares no range at all', () => {
    // The control. Unconstrained must never be reported as out of range.
    const result = assessScaleVisibility(AT_THE_LIVE_VIEW, {});
    expect(result.visible).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('reports NOT visible, zoomed too far OUT, for the real reported case', () => {
    const result = assessScaleVisibility(AT_THE_LIVE_VIEW, { maxScaleDenominator: 6_000_000 });
    expect(result.visible).toBe(false);
    expect(result.direction).toBe('zoom-in');
  });

  it('says what to do and names both numbers', () => {
    // A warning that does not say how far, or which way, leaves the user
    // guessing — which is barely better than the blank map it replaced.
    const result = assessScaleVisibility(AT_THE_LIVE_VIEW, { maxScaleDenominator: 6_000_000 });
    expect(result.reason).toMatch(/zoom in/i);
    expect(result.reason).toContain('6,000,000');
  });

  it('reports visible once the view is inside the range', () => {
    const closeIn = scaleDenominatorFor(12, 55);
    expect(closeIn).toBeLessThan(6_000_000);
    expect(assessScaleVisibility(closeIn, { maxScaleDenominator: 6_000_000 }).visible).toBe(true);
  });

  it('handles the other direction — an overview layer dropped when you zoom in', () => {
    const closeIn = scaleDenominatorFor(14, 55);
    const result = assessScaleVisibility(closeIn, { minScaleDenominator: 1_000_000 });
    expect(result.visible).toBe(false);
    expect(result.direction).toBe('zoom-out');
    expect(result.reason).toMatch(/zoom out/i);
  });

  it('respects both bounds at once', () => {
    const band = { minScaleDenominator: 100_000, maxScaleDenominator: 1_000_000 };
    expect(assessScaleVisibility(500_000, band).visible).toBe(true);
    expect(assessScaleVisibility(5_000_000, band).direction).toBe('zoom-in');
    expect(assessScaleVisibility(50_000, band).direction).toBe('zoom-out');
  });

  it('treats the boundary as visible rather than refusing on the edge', () => {
    // A layer exactly at its limit draws. Reporting it as broken would warn on
    // a working view, which trains people to ignore the warning.
    expect(assessScaleVisibility(6_000_000, { maxScaleDenominator: 6_000_000 }).visible).toBe(true);
  });

  it('ignores a non-finite view scale rather than warning on nonsense', () => {
    expect(assessScaleVisibility(Number.NaN, { maxScaleDenominator: 6_000_000 }).visible).toBe(true);
  });
});
