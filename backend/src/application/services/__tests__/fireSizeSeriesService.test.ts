import { describe, it, expect } from 'vitest';
import { resolveFireSizeSeries } from '../fireSizeSeriesService.js';
import type { FireSizeSeriesArtifact } from '../../interfaces/index.js';

const SERIES: FireSizeSeriesArtifact = {
  days: [
    {
      julianDay: 176,
      date: '2023-06-25',
      sizesHa: [209352, 227341],
      summary: {
        n: 2,
        minHa: 209352,
        maxHa: 227341,
        meanHa: 218346.5,
        degenerate: false,
        percentileStats: { kind: 'withheld', n: 2, reason: 'ensemble of 2 is too small for a median or percentile' },
      },
      reducedPrecision: false,
    },
  ],
  n: 2,
  nConstantAcrossDays: true,
  reducedPrecision: false,
};

const EMPTY: FireSizeSeriesArtifact = {
  days: [],
  n: null,
  nConstantAcrossDays: true,
  reducedPrecision: false,
};

function deps(opts: {
  filePaths?: (string | null)[];
  series?: FireSizeSeriesArtifact;
  onRead?: (simDir: string) => void;
}) {
  const results = (opts.filePaths ?? ['abc/probability_176_2023-06-25.tif']).map(fp => ({
    metadata: { filePath: fp ?? undefined },
  }));
  return {
    findResults: async () => results as never[],
    gateway: {
      resolveResultFilePath: (p: string) => `/sims/${p}`,
      readFireSizeSeries: (simDir: string) => {
        opts.onRead?.(simDir);
        return opts.series ?? SERIES;
      },
    },
  };
}

describe('resolveFireSizeSeries', () => {
  it('reads the series from the directory holding the first result file', async () => {
    let seen: string | null = null;
    const d = deps({ onRead: s => (seen = s) });
    const out = await resolveFireSizeSeries('m1', d.findResults, d.gateway);
    expect(seen).toBe('/sims/abc');
    expect(out.hasEnsemble).toBe(true);
    expect(out.series?.n).toBe(2);
  });

  it('skips results carrying no file path instead of giving up on the first one', async () => {
    let seen: string | null = null;
    const d = deps({ filePaths: [null, null, 'xyz/perimeter.tif'], onRead: s => (seen = s) });
    const out = await resolveFireSizeSeries('m1', d.findResults, d.gateway);
    expect(seen).toBe('/sims/xyz');
    expect(out.hasEnsemble).toBe(true);
  });

  it('reports NO ENSEMBLE rather than an empty distribution when the run recorded none', async () => {
    // 12 of 73 real runs have no sizes files. hasEnsemble is the flag a caller
    // needs; an empty days array alone reads as a distribution of nothing.
    const d = deps({ series: EMPTY });
    const out = await resolveFireSizeSeries('m1', d.findResults, d.gateway);
    expect(out.hasEnsemble).toBe(false);
    expect(out.series).toBeNull();
    expect(out.reason).toMatch(/no fire-size/i);
  });

  it('reports no ensemble when the model has no results at all', async () => {
    const d = deps({ filePaths: [] });
    const out = await resolveFireSizeSeries('m1', d.findResults, d.gateway);
    expect(out.hasEnsemble).toBe(false);
    expect(out.reason).toMatch(/no result/i);
  });

  it('reports no ensemble when every result lacks a file path', async () => {
    const d = deps({ filePaths: [null, null] });
    const out = await resolveFireSizeSeries('m1', d.findResults, d.gateway);
    expect(out.hasEnsemble).toBe(false);
    expect(out.reason).toMatch(/file path/i);
  });

  it('surfaces the caveats a consumer cannot derive', async () => {
    const d = deps({
      series: { ...SERIES, reducedPrecision: true, nConstantAcrossDays: false },
    });
    const out = await resolveFireSizeSeries('m1', d.findResults, d.gateway);
    expect(out.series?.reducedPrecision).toBe(true);
    expect(out.series?.nConstantAcrossDays).toBe(false);
  });
});
