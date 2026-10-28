import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readFireSizeSeries } from '../fireSizeSeries.js';

/**
 * Fixture contents are the real values from run c7ea0072, whose seven CSVs each
 * hold two rows while its log says it ran six simulations.
 */
const C7EA0072: Record<string, string> = {
  'sizes_170_2023-06-19.csv': '186994\n186994\n',
  'sizes_171_2023-06-20.csv': '187230\n217399\n',
  'sizes_172_2023-06-21.csv': '204248\n217940\n',
  'sizes_176_2023-06-25.csv': '209352\n227341\n',
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nomad-sizes-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('readFireSizeSeries', () => {
  it('returns one entry per sizes file, ascending by Julian day', () => {
    // Writing them out of order is NOT enough to test the sort: readdirSync
    // returns names already lexicographically ordered, and for days 170/171/176
    // that order IS the numeric one, so deleting the sort passed this test.
    // Proven by mutation, 2026-10-26. These days are chosen so lexicographic
    // and numeric order DISAGREE: '100' < '9' as text, 9 < 100 as numbers.
    writeFileSync(join(dir, 'sizes_100_2023-04-10.csv'), '5\n6\n');
    writeFileSync(join(dir, 'sizes_9_2023-01-09.csv'), '1\n2\n');
    writeFileSync(join(dir, 'sizes_21_2023-01-21.csv'), '3\n4\n');
    const series = readFireSizeSeries(dir);
    expect(series.days.map(d => d.julianDay)).toEqual([9, 21, 100]);
    expect(series.days.map(d => d.date)).toEqual(['2023-01-09', '2023-01-21', '2023-04-10']);
  });

  it('reads the date and sizes of each day it returns (run c7ea0072)', () => {
    for (const name of Object.keys(C7EA0072)) writeFileSync(join(dir, name), C7EA0072[name]);
    const series = readFireSizeSeries(dir);
    expect(series.days.map(d => d.julianDay)).toEqual([170, 171, 172, 176]);
    expect(series.days.map(d => d.date)).toEqual(['2023-06-19', '2023-06-20', '2023-06-21', '2023-06-25']);
  });

  it('carries the parsed sizes and OUR statistics per day', () => {
    writeFileSync(join(dir, 'sizes_176_2023-06-25.csv'), C7EA0072['sizes_176_2023-06-25.csv']);
    const [day] = readFireSizeSeries(dir).days;
    expect(day.sizesHa).toEqual([209352, 227341]);
    expect(day.summary.n).toBe(2);
    // the log for this day says mean 218346.5, median 227341 — the mean agrees,
    // the median does not, because the logged one is the upper middle value
    expect(day.summary.meanHa).toBe(218346.5);
  });

  it('reports N as the maximum row count seen, and that it is constant', () => {
    writeFileSync(join(dir, 'sizes_170_2023-06-19.csv'), C7EA0072['sizes_170_2023-06-19.csv']);
    writeFileSync(join(dir, 'sizes_171_2023-06-20.csv'), C7EA0072['sizes_171_2023-06-20.csv']);
    const series = readFireSizeSeries(dir);
    expect(series.n).toBe(2);
    expect(series.nConstantAcrossDays).toBe(true);
  });

  it('FLAGS a run whose row count varies between days instead of averaging over it', () => {
    // Not observed in any of the 61 real runs. Flagged rather than trusted,
    // because a changing population silently invalidates a day-over-day series.
    writeFileSync(join(dir, 'sizes_170_2023-06-19.csv'), '1\n2\n');
    writeFileSync(join(dir, 'sizes_171_2023-06-20.csv'), '1\n2\n3\n');
    const series = readFireSizeSeries(dir);
    expect(series.nConstantAcrossDays).toBe(false);
  });

  it('propagates the reduced-precision flag up to the series', () => {
    writeFileSync(join(dir, 'sizes_170_2023-06-19.csv'), '1.64288e+06\n1.64288e+06\n');
    expect(readFireSizeSeries(dir).reducedPrecision).toBe(true);
    rmSync(join(dir, 'sizes_170_2023-06-19.csv'));
    writeFileSync(join(dir, 'sizes_170_2023-06-19.csv'), '209352\n227341\n');
    expect(readFireSizeSeries(dir).reducedPrecision).toBe(false);
  });

  it('ignores every other artefact in the run directory', () => {
    writeFileSync(join(dir, 'sizes_170_2023-06-19.csv'), C7EA0072['sizes_170_2023-06-19.csv']);
    writeFileSync(join(dir, 'probability_170_2023-06-19.tif'), 'not a csv');
    writeFileSync(join(dir, 'firestarr.log'), 'Ran 6 simulations');
    writeFileSync(join(dir, 'weather.csv'), 'hour,temp\n');
    mkdirSync(join(dir, 'sizes_999_2023-01-01.csv'), { recursive: true });
    const series = readFireSizeSeries(dir);
    expect(series.days.map(d => d.julianDay)).toEqual([170]);
  });

  it('returns an EMPTY series for a run with no sizes files, distinguishably', () => {
    // 12 of 73 real run directories have none. That is "no ensemble recorded",
    // which must not render as an ensemble of size zero.
    const series = readFireSizeSeries(dir);
    expect(series.days).toEqual([]);
    expect(series.n).toBeNull();
    expect(series.nConstantAcrossDays).toBe(true);
  });

  it('returns an empty series for a directory that does not exist, not a throw', () => {
    const series = readFireSizeSeries(join(dir, 'nope'));
    expect(series.days).toEqual([]);
    expect(series.n).toBeNull();
  });
});
