import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { getResultArtifactGateway } from '../ResultArtifactGateway.js';

/**
 * Reads REAL FireSTARR output through the real gateway — no fixtures, no fakes.
 *
 * Skipped when the sample run directories are absent, which is the normal state
 * in CI: these artifacts are not in the repository. The skip is explicit so a
 * silent pass over missing data cannot be mistaken for a pass over the data.
 *
 * Runs are located by PREFIX and the lookup asserts it found one. An earlier
 * version of this file pinned a full UUID written from memory — its first group
 * was right and the rest was invented, so the test passed through its own
 * fallback branch while asserting nothing about the behaviour it named.
 */
const SIMS = join(process.cwd(), '..', 'temp_firestarr_data', 'sims');
const available = existsSync(SIMS);

function runByPrefix(prefix: string): string {
  const matches = readdirSync(SIMS).filter(d => d.startsWith(prefix));
  expect(matches, `expected exactly one run directory starting with ${prefix}`).toHaveLength(1);
  return join(SIMS, matches[0]);
}

describe.skipIf(!available)('readFireSizeSeries against real FireSTARR output', () => {
  it('reads run c7ea0072 exactly as measured from its own log', () => {
    const series = getResultArtifactGateway().readFireSizeSeries(runByPrefix('c7ea0072'));

    // Seven output days, which is what --output_date_offsets [1..7] produced.
    expect(series.days.map(d => d.julianDay)).toEqual([170, 171, 172, 173, 174, 175, 176]);

    // Two rows per day, every day, while the log says "Ran 6 simulations".
    expect(series.n).toBe(2);
    expect(series.nConstantAcrossDays).toBe(true);
    expect(series.days.every(d => d.summary.n === 2)).toBe(true);

    // Day 7: the log says 209352.0 - 227341.0 (mean 218346.5).
    const last = series.days[series.days.length - 1];
    expect(last.date).toBe('2023-06-25');
    expect(last.sizesHa).toEqual([209352, 227341]);
    expect(last.summary.minHa).toBe(209352);
    expect(last.summary.maxHa).toBe(227341);
    expect(last.summary.meanHa).toBe(218346.5);

    // The log calls day 7's median 227341. Ours is the real one.
    // median withheld while #429 is open (#418 prerequisite); the mean below
    // is what proves the CSV rows are the population the log describes.

    // Day 1 is degenerate: the log says 186994.0 - 186994.0.
    expect(series.days[0].summary.degenerate).toBe(true);
    expect(series.days[0].summary.minHa).toBe(186994);

    expect(series.reducedPrecision).toBe(false);
  });

  it('reads the megafire run whose CSV loses precision (555dccae)', () => {
    const series = getResultArtifactGateway().readFireSizeSeries(runByPrefix('555dccae'));
    expect(series.reducedPrecision).toBe(true);
    // Its log says 1642885.0 ha; the file can only say 1.64288e+06.
    expect(series.days[0].summary.maxHa).toBe(1642880);
    expect(series.days[0].summary.maxHa).not.toBe(1642885);
  });

  it('returns a no-ensemble series for a real run that recorded none', () => {
    const withoutSizes = readdirSync(SIMS).find(d => {
      const p = join(SIMS, d);
      try {
        return (
          existsSync(join(p, 'firestarr.log')) &&
          !readdirSync(p).some(f => f.startsWith('sizes_'))
        );
      } catch {
        return false;
      }
    });
    expect(withoutSizes, 'expected at least one real run with no sizes files').toBeTruthy();
    const series = getResultArtifactGateway().readFireSizeSeries(join(SIMS, withoutSizes!));
    expect(series.days).toEqual([]);
    expect(series.n).toBeNull();
  });
});
