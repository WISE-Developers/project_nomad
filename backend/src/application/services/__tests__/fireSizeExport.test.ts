import { describe, it, expect } from 'vitest';
import { buildFireSizeExport } from '../fireSizeExport.js';
import type { FireSizeSeriesArtifact } from '../../interfaces/index.js';

const series: FireSizeSeriesArtifact = {
  days: [
    {
      julianDay: 176, date: '2023-06-25', sizesHa: [209352, 227341], reducedPrecision: false,
      summary: {
        n: 2, minHa: 209352, maxHa: 227341, meanHa: 218346.5, medianHa: 218346.5,
        percentilesHa: { 50: 218346.5, 90: 225542.1, 95: 226441.55 }, degenerate: false,
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
    expect(out.provenance).toMatch(/median/i);
  });

  it('is valid pretty-printed JSON', () => {
    const text = buildFireSizeExport(series)!;
    expect(text.endsWith('\n')).toBe(true);
    expect(() => JSON.parse(text)).not.toThrow();
    expect(text).toContain('\n  ');
  });
});
