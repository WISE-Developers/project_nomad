import { describe, it, expect } from 'vitest';
import { buildFireSizeExport } from '../fireSizeExport.js';
import { summariseFireSizes } from '../../../infrastructure/firestarr/fireSizeSeries.js';
import type { FireSizeSeriesArtifact } from '../../interfaces/index.js';

/**
 * #419's "as data, not only as a picture" acceptance criterion, for the
 * median and percentiles now that #429 is answered.
 *
 * Two things have to be true of the payload, and the second is the one a
 * reader cannot recover for themselves:
 *
 * 1. The statistics are present per day, in the discriminated shape, so a
 *    consumer gets one presence check rather than three nullable fields.
 * 2. The PROVENANCE text states the definition. FireSTARR's median is
 *    nearest-rank and returns the UPPER middle value for even N, so Nomad's
 *    figure will AGREE with `firestarr.log` — and a conventional median would
 *    have disagreed. Either way the definition has to be written down, or a
 *    user comparing the two reasonably concludes one is broken. The old
 *    provenance said "no median and no percentiles are reported ... see #429",
 *    which is now false and would mislead anyone reading an export.
 */

function seriesFrom(sizesByDay: number[][]): FireSizeSeriesArtifact {
  const days = sizesByDay.map((sizesHa, i) => ({
    julianDay: 170 + i,
    date: `2023-06-${19 + i}`,
    sizesHa,
    summary: summariseFireSizes(sizesHa),
    reducedPrecision: false,
  }));
  return {
    days,
    n: days[0].sizesHa.length,
    nConstantAcrossDays: new Set(sizesByDay.map(d => d.length)).size === 1,
    reducedPrecision: false,
  } as FireSizeSeriesArtifact;
}

describe('buildFireSizeExport: median and percentiles in the payload (#419)', () => {
  it('ships the statistics for an ensemble at or above the floor', () => {
    const json = buildFireSizeExport(seriesFrom([[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]]));
    expect(json).not.toBeNull();
    const parsed = JSON.parse(json as string);
    const stats = parsed.days[0].summary.percentileStats;

    expect(stats.kind).toBe('available');
    expect(stats.medianHa).toBe(6);
    expect(stats.percentilesHa['90']).toBe(10);
    expect(stats.percentilesHa['95']).toBe(11);
  });

  it('ships the WITHHELD branch with its reason and N below the floor', () => {
    const json = buildFireSizeExport(seriesFrom([[209352, 227341]]));
    const parsed = JSON.parse(json as string);
    const stats = parsed.days[0].summary.percentileStats;

    expect(stats.kind).toBe('withheld');
    expect(stats.n).toBe(2);
    expect(stats.reason).toContain('2');
    // min/max/mean still describe the rows that are present
    expect(parsed.days[0].summary.meanHa).toBe(218346.5);
  });

  it('STATES THE DEFINITION in provenance, and no longer claims the median is withheld outright', () => {
    const json = buildFireSizeExport(seriesFrom([[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]])) as string;
    const parsed = JSON.parse(json);
    const p: string = parsed.provenance;

    // The definition a reader needs in order to reconcile us with firestarr.log.
    expect(p).toMatch(/nearest-rank/i);
    expect(p).toMatch(/upper/i);

    // And the floor, because a reader seeing no median on a small run needs to
    // know that is deliberate rather than a gap in the data.
    expect(p).toMatch(/11/);

    // The stale claim must be gone: it is now false.
    expect(p).not.toMatch(/no median and no percentiles are reported/i);
  });

  it('CONTROL: the function still returns null for a run with no ensemble', () => {
    // Proves these assertions are about content rather than about the happy path
    // existing at all — an empty file would read as an ensemble of zero.
    const empty = { days: [], n: null, nConstantAcrossDays: true, reducedPrecision: false };
    expect(buildFireSizeExport(empty as FireSizeSeriesArtifact)).toBeNull();
  });
});
