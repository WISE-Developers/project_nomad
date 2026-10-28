import { describe, it, expect } from 'vitest';
import { buildFireSizeExport } from '../fireSizeExport.js';
import type { FireSizeSeriesArtifact } from '../../interfaces/index.js';

const series: FireSizeSeriesArtifact = {
  days: [
    {
      julianDay: 176, date: '2023-06-25', sizesHa: [209352, 227341], reducedPrecision: false,
      summary: {
        n: 2, minHa: 209352, maxHa: 227341, meanHa: 218346.5, degenerate: false,
        // N=2 is below the N>=11 floor, so the statistics are withheld with a
        // reason rather than absent or defaulted (#419, #429 answered).
        percentileStats: { kind: 'withheld', n: 2, reason: 'ensemble of 2 is too small for a median or percentile' },
      },
    },
  ],
  n: 2, nConstantAcrossDays: true, reducedPrecision: false,
};

describe('buildFireSizeExport', () => {
  it('returns null when there is no ensemble, so no empty file is shipped', () => {
    expect(buildFireSizeExport({ days: [], n: null, nConstantAcrossDays: true, reducedPrecision: false })).toBeNull();
  });

  it('carries the per-simulation values, not only the summary', () => {
    // "as data, not only as a picture" — a consumer must be able to recompute
    // any statistic we did not think to include.
    const out = JSON.parse(buildFireSizeExport(series)!);
    expect(out.days[0].sizesHa).toEqual([209352, 227341]);
  });

  it('states N and the caveats a reader cannot derive from the numbers', () => {
    const out = JSON.parse(buildFireSizeExport(series)!);
    expect(out.n).toBe(2);
    expect(out.nConstantAcrossDays).toBe(true);
    expect(out.reducedPrecision).toBe(false);
    expect(out.units).toBe('hectares');
  });

  it('records WHERE the statistics came from, so nobody re-derives them from the log', () => {
    const out = JSON.parse(buildFireSizeExport(series)!);
    expect(out.provenance).toMatch(/sizes_/);
    expect(out.provenance).toMatch(/row count/i);
  });

  it('WITHHOLDS the median and percentiles below the N>=11 floor, in the serialised payload', () => {
    // RE-AIMED 2026-10-28. #429 is answered, so the original proposition --
    // "no median while the population is unknown" -- no longer describes the
    // rule. Its measurements are kept below because they are real and still
    // explain the floor, and the assertion now tests the floor rather than the
    // absence of a field. A test that passes because the property it names no
    // longer exists is not vindicated, it is misleading to the next reader,
    // who takes the green tick as evidence the old prohibition still holds.
    //
    // The evidence it rests on: run c7ea0072 logs six simulations with six
    // distinct final sizes while sizes_176_2023-06-25.csv holds two rows. So N
    // is a row count, not a simulation count, and the rows are an unknown
    // subset. A correctly computed median over an unknown population is still
    // a statistic over an unknown population.
    //
    // Asserted on the SERIALISED payload rather than the object, because that
    // is what actually reaches a reader.
    // Asserted on the serialised KEYS, not on the words: the provenance string
    // deliberately mentions the median in order to explain its absence, so a
    // bare /median/i search on the text fails for the right reason and the
    // wrong one at once. This was caught by that test failing on its own fix.
    const out = JSON.parse(buildFireSizeExport(series)!);
    const stats = out.days[0].summary.percentileStats;

    // N=2: withheld, and the reader is TOLD rather than left to notice an
    // absence. The withheld branch carries N so the message can name it.
    expect(stats.kind).toBe('withheld');
    expect(stats.n).toBe(2);
    expect(stats.reason).toBeTruthy();
    expect(stats).not.toHaveProperty('medianHa');
    expect(stats).not.toHaveProperty('percentilesHa');

    // THE DISCRIMINATING CONTROL. Without this the assertions above pass for an
    // implementation that never publishes a median at all, which is exactly the
    // vacuity this test was re-aimed to escape: an above-floor ensemble MUST
    // carry one, or "withheld below the floor" is not what is being tested.
    const above = {
      days: [{
        julianDay: 176, date: '2023-06-25',
        sizesHa: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        reducedPrecision: false,
        summary: {
          n: 11, minHa: 1, maxHa: 11, meanHa: 6, degenerate: false,
          percentileStats: {
            kind: 'available' as const,
            medianHa: 6,
            percentilesHa: { 50: 6, 90: 10, 95: 11 },
          },
        },
      }],
      n: 11, nConstantAcrossDays: true, reducedPrecision: false,
    };
    const aboveOut = JSON.parse(buildFireSizeExport(above as FireSizeSeriesArtifact)!);
    expect(aboveOut.days[0].summary.percentileStats.kind).toBe('available');
    expect(aboveOut.days[0].summary.percentileStats.medianHa).toBe(6);

    // The provenance states the definition and the floor, so a reader can
    // reconcile us with firestarr.log instead of assuming one of us is broken.
    expect(aboveOut.provenance).toMatch(/nearest-rank/i);
    expect(aboveOut.provenance).toMatch(/11/);
    expect(aboveOut.provenance).toMatch(/#429/);
  });

  it('still publishes the statistics #418 did NOT withhold', () => {
    // The control for the test above. Without it, emitting an empty summary --
    // or nothing at all -- would satisfy the absence assertions.
    const out = JSON.parse(buildFireSizeExport(series)!);
    expect(out.days[0].summary.n).toBe(2);
    expect(out.days[0].summary.minHa).toBe(209352);
    expect(out.days[0].summary.maxHa).toBe(227341);
    expect(out.days[0].summary.meanHa).toBe(218346.5);
    expect(out.days[0].summary.degenerate).toBe(false);
  });

  it('is valid pretty-printed JSON', () => {
    const text = buildFireSizeExport(series)!;
    expect(text.endsWith('\n')).toBe(true);
    expect(() => JSON.parse(text)).not.toThrow();
    expect(text).toContain('\n  ');
  });
});
