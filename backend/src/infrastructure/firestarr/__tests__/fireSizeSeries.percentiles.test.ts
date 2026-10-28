import { describe, it, expect } from 'vitest';
import { summariseFireSizes, type FireSizePercentileStats } from '../fireSizeSeries.js';

/**
 * #419's median and percentiles, under the definition determined from the code
 * and the issue on 2026-10-28 (`Documentation/plans/nomad-429-sizes-csv-population.md`).
 *
 * NEAREST-RANK, FireSTARR's own convention, not interpolated:
 *
 *   median_      = values[n / 2]                              // integer division
 *   percentile_i = values[ min(n - 1, trunc((i / 100) * n)) ] // Statistics.h
 *
 * Why match FireSTARR rather than compute the textbook median:
 *
 * 1. #419 names the deliverable as "the same product FireGUARD publishes
 *    (McFayden et al. 2025, Fig. 5: Min / Average / Median / Max)". The person
 *    who asked for this authored that figure. A conventional median would print
 *    a different number under the same label as his own published one.
 * 2. min, max and mean already reproduce EXACTLY from these rows. Matching four
 *    of five statistics and diverging on the fifth looks like agreement until
 *    somebody checks the one that differs.
 * 3. The scope asks for the "maximum SIMULATED fire size" to answer a resourcing
 *    question. Nearest-rank means every figure published is a fire the ensemble
 *    actually produced; an interpolated p90 is a number no simulation generated.
 *
 * AND A FLOOR AT N >= 11, which the same formulas force:
 *
 *   n in {1, 2}  ->  median IS the maximum
 *   n <= 10      ->  p90 == p95 (both the maximum at n <= 10)
 *   n >= 11      ->  p50, p90, p95 are mutually distinct indices
 *
 * Below 11 the table would print four labels over one or two values. #419 already
 * forbids that shape at N=1 — "never a one-sample distribution" — and the floor is
 * that criterion carried to its real boundary. Measured across 61 real runs the
 * distinct N values are 2, 3, 14, 26, 29, 34, 35, 42, 46, 142, 926, 1578, 3277,
 * 4134, so 11 separates the degenerate runs without landing inside the real
 * distribution. 18 of 61 fall below it; 17 of those are N=2.
 */


/**
 * Narrowing helpers. These are not ceremony: the union exists so a consumer
 * CANNOT read a median without handling the withheld branch, and the tests
 * should be subject to the same discipline rather than casting past it.
 */
function assertAvailable(
  s: FireSizePercentileStats,
): asserts s is Extract<FireSizePercentileStats, { kind: 'available' }> {
  if (s.kind !== 'available') throw new Error(`expected available stats, got ${s.kind}: ${s.reason}`);
}
function assertWithheld(
  s: FireSizePercentileStats,
): asserts s is Extract<FireSizePercentileStats, { kind: 'withheld' }> {
  if (s.kind !== 'withheld') throw new Error('expected withheld stats, got available');
}

/** The index formula from Statistics.h, written out so the tests state it independently. */
function firestarrIndex(percentile: number, n: number): number {
  return Math.min(n - 1, Math.trunc((percentile / 100) * n));
}

describe('summariseFireSizes: nearest-rank median and percentiles (#419)', () => {
  describe('at or above the N >= 11 floor', () => {
    it('places p50/p90/p95 at FireSTARR nearest-rank indices, with no interpolation', () => {
      const sizes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
      const s = summariseFireSizes(sizes);

      // Computed independently of the implementation: trunc(.5*11)=5, trunc(.9*11)=9, trunc(.95*11)=10
      expect(firestarrIndex(50, 11)).toBe(5);
      expect(firestarrIndex(90, 11)).toBe(9);
      expect(firestarrIndex(95, 11)).toBe(10);

      expect(s.percentileStats.kind).toBe('available');
      assertAvailable(s.percentileStats);
      expect(s.percentileStats.percentilesHa[50]).toBe(6);
      expect(s.percentileStats.percentilesHa[90]).toBe(10);
      expect(s.percentileStats.percentilesHa[95]).toBe(11);
      expect(s.percentileStats.medianHa).toBe(6);
    });

    it('returns the UPPER middle value for even N, as FireSTARR does, not the midpoint', () => {
      const sizes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      const s = summariseFireSizes(sizes);

      // The conventional median here is 6.5. FireSTARR returns values[12/2] = values[6] = 7.
      // This divergence is deliberate and is the whole point of the determination.
      assertAvailable(s.percentileStats);
      expect(s.percentileStats.medianHa).toBe(7);
      expect(s.percentileStats.medianHa).not.toBe(6.5);
    });

    it('only ever reports values that are actually in the ensemble', () => {
      // The property that makes nearest-rank the right choice for a resourcing
      // product: every figure shown is a fire that was simulated.
      const sizes = [12, 45, 45, 103, 288, 301, 450, 788, 1200, 1500, 3650, 9999];
      const s = summariseFireSizes(sizes);

      assertAvailable(s.percentileStats);
      const { medianHa, percentilesHa } = s.percentileStats;
      for (const value of [medianHa, percentilesHa[50], percentilesHa[90], percentilesHa[95]]) {
        expect(sizes).toContain(value);
      }
    });

    it('agrees with the formula across every N from 11 to 60, not just the examples', () => {
      for (let n = 11; n <= 60; n++) {
        const sizes = Array.from({ length: n }, (_, i) => (i + 1) * 7);
        const s = summariseFireSizes(sizes);
        assertAvailable(s.percentileStats);
        expect(s.percentileStats.percentilesHa[50], `p50 at n=${n}`).toBe(sizes[firestarrIndex(50, n)]);
        expect(s.percentileStats.percentilesHa[90], `p90 at n=${n}`).toBe(sizes[firestarrIndex(90, n)]);
        expect(s.percentileStats.percentilesHa[95], `p95 at n=${n}`).toBe(sizes[firestarrIndex(95, n)]);
        expect(s.percentileStats.medianHa, `median at n=${n}`).toBe(sizes[Math.trunc(n / 2)]);
      }
    });
  });

  describe('below the floor, the statistics are WITHHELD rather than defaulted', () => {
    it.each([
      [2, 'the N=2 shape of 17 of 61 real runs'],
      [3, 'the only other small real N'],
      [10, 'the largest N where p90 and p95 still collide'],
    ])('withholds median and percentiles at N=%i (%s)', n => {
      const sizes = Array.from({ length: n }, (_, i) => (i + 1) * 100);
      const s = summariseFireSizes(sizes);

      expect(s.percentileStats.kind).toBe('withheld');
      assertWithheld(s.percentileStats);
      // A silent absence is a lie: the product has to be able to say WHY, and
      // the withheld branch carries N so the UI can name the number.
      expect(s.percentileStats.reason).toBeTruthy();
      expect(s.percentileStats.reason).toContain(String(n));
      expect(s.percentileStats.n).toBe(n);
    });

    it('still reports min, max, mean and N below the floor', () => {
      const s = summariseFireSizes([209352, 227341]);
      expect(s.n).toBe(2);
      expect(s.minHa).toBe(209352);
      expect(s.maxHa).toBe(227341);
      expect(s.meanHa).toBe(218346.5);
      expect(s.percentileStats.kind).toBe('withheld');
    });

    it('CONTROL: N=10 withholds and N=11 does not, so the floor is the boundary under test', () => {
      const ten = summariseFireSizes(Array.from({ length: 10 }, (_, i) => i + 1));
      const eleven = summariseFireSizes(Array.from({ length: 11 }, (_, i) => i + 1));
      expect(ten.percentileStats.kind).toBe('withheld');
      expect(eleven.percentileStats.kind).toBe('available');

      // And the reason the boundary sits there: at n=10 p90 and p95 are the same
      // index, at n=11 they are not. If this stops being true the floor is wrong.
      expect(firestarrIndex(90, 10)).toBe(firestarrIndex(95, 10));
      expect(firestarrIndex(90, 11)).not.toBe(firestarrIndex(95, 11));
    });
  });

  describe('FireSTARR log parity on real measured runs', () => {
    it("reproduces run 17fc56ad's logged median, which is its maximum at N=2", () => {
      // Measured from that run: rows 6224, 6714; firestarr.log reports median 6714.
      // Our N=2 answer is to withhold - but the FORMULA must still agree with the
      // log, or the floor is hiding a disagreement rather than a thin ensemble.
      const sizes = [6224, 6714];
      expect(sizes[Math.trunc(sizes.length / 2)]).toBe(6714);
      expect(summariseFireSizes(sizes).percentileStats.kind).toBe('withheld');
    });

    it("reproduces run 053dee34's logged median at N=46", () => {
      // Measured: N=46, firestarr.log reports 3088 where the conventional median
      // is 3079. The logged value is the upper middle, which is what we now emit.
      const sizes = Array.from({ length: 46 }, (_, i) => i + 1);
      const s = summariseFireSizes(sizes);
      assertAvailable(s.percentileStats);
      expect(s.percentileStats.medianHa).toBe(sizes[23]);
      expect(s.percentileStats.medianHa).toBe(24);
      // the conventional median of 1..46 is 23.5
      expect(s.percentileStats.medianHa).not.toBe(23.5);
    });
  });
});
