import { describe, it, expect } from 'vitest';
import { buildFireSizeExport } from '../fireSizeExport.js';
import type { FireSizeSeriesArtifact } from '../../interfaces/index.js';

const series: FireSizeSeriesArtifact = {
  days: [
    {
      julianDay: 176, date: '2023-06-25', sizesHa: [209352, 227341], reducedPrecision: false,
      summary: {
        n: 2, minHa: 209352, maxHa: 227341, meanHa: 218346.5, degenerate: false,
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

  it('publishes NO median and NO percentile while #429 is open', () => {
    // #418's blocking prerequisite, verbatim: "Do not compute a median or a
    // percentile until it is answered, or we will publish a statistic over an
    // unknown population." #429 is that question and is still open.
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
    const text = buildFireSizeExport(series)!;
    expect(text).not.toMatch(/"medianHa"/);
    expect(text).not.toMatch(/"percentilesHa"/);

    const out = JSON.parse(text);
    expect(out.days[0].summary).not.toHaveProperty('medianHa');
    expect(out.days[0].summary).not.toHaveProperty('percentilesHa');

    // And the reader is TOLD, rather than left to notice an absence.
    expect(out.provenance).toMatch(/no median/i);
    expect(out.provenance).toMatch(/#429/);
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
