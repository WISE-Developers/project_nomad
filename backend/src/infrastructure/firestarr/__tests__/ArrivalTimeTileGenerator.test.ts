/**
 * Tests for ArrivalTimeTileGenerator color-table classification (refs #261).
 *
 * FireSTARR writes 0-indexed Julian values inside arrival.tif rasters
 * (Jan 1 = 0.0). Filenames use 1-indexed Julian. The color-table bucket
 * thresholds must convert from filename space to raster-value space, or
 * cells in the final day of the sim are silently binned one bucket too low,
 * leaving the visible "last day" classification empty.
 */

import { describe, it, expect } from 'vitest';
import { buildArrivalColorTable } from '../ArrivalTimeTileGenerator.js';

type ColorEntry = { value: number; r: number; g: number; b: number; a: number };

function parseColorTable(table: string): ColorEntry[] {
  return table
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('nv'))
    .map((l) => {
      const parts = l.split(/\s+/).map(Number);
      return { value: parts[0], r: parts[1], g: parts[2], b: parts[3], a: parts[4] };
    });
}

describe('buildArrivalColorTable — FireSTARR 0-indexed Julian convention (#261)', () => {
  it('places a max raster value of 171.917 (Jun 21 22:00 UTC, sim ending Jun 22) in the LAST daily bucket', () => {
    // Reproducer parameters from sim f81a3c40 (3-day deterministic, Jun 19-21):
    //   offsetDay = 170 (filename for Jun 19, 1-indexed)
    //   endJulian = 173 (last.julianDay + 1)
    //   raster max value = 171.917 (FireSTARR 0-indexed = Jun 21 22:00 UTC)
    const table = buildArrivalColorTable(170, 173, 'daily');
    const entries = parseColorTable(table);

    // Three daily buckets expected: Jun 19, Jun 20, Jun 21.
    // Each bucket is emitted as a (min, max) pair sharing the same color,
    // so 3 buckets = 6 colored entries (plus leading "0 0 0 0 0" NoData entry).
    const colored = entries.filter((e) => e.a === 220);
    expect(colored.length).toBe(6);

    // The LAST bucket should contain raster value 171.917
    const lastBucketMin = colored[colored.length - 2].value;
    const lastBucketMax = colored[colored.length - 1].value;

    expect(171.917).toBeGreaterThanOrEqual(lastBucketMin);
    expect(171.917).toBeLessThanOrEqual(lastBucketMax);
  });

  it('places minimum raster value (169.587 = Jun 19 14:05 pre-warmup) in the FIRST daily bucket', () => {
    const table = buildArrivalColorTable(170, 173, 'daily');
    const colored = parseColorTable(table).filter((e) => e.a === 220);

    const firstBucketMin = colored[0].value;
    const firstBucketMax = colored[1].value;

    expect(169.587).toBeGreaterThanOrEqual(firstBucketMin);
    expect(169.587).toBeLessThanOrEqual(firstBucketMax);
  });
});

describe('buildArrivalColorTable — viridis day-keyed colours (#274)', () => {
  const rgb = (e: ColorEntry): [number, number, number] => [e.r, e.g, e.b];

  it('colours each daily bucket with the viridis day base — no red ramp', () => {
    // 3-day model → 3 day bases spread across viridis. Byte-identical to the
    // frontend legend (arrivalTimeSymbolization) so map pixels == swatches.
    const colored = parseColorTable(buildArrivalColorTable(170, 173, 'daily')).filter(
      (e) => e.a === 220,
    );
    expect(rgb(colored[0])).toEqual([68, 1, 84]); // viridis low — purple
    expect(rgb(colored[2])).toEqual([33, 145, 140]); // viridis mid — teal
    expect(rgb(colored[4])).toEqual([253, 231, 37]); // viridis high — yellow
    // both entries of a bucket share the colour
    expect(rgb(colored[1])).toEqual([68, 1, 84]);
  });

  it('hourly: each day is a band of its base with an intra-day gradient', () => {
    const colored = parseColorTable(buildArrivalColorTable(170, 173, 'hourly')).filter(
      (e) => e.a === 220,
    );
    expect(colored.length).toBe(3 * 24 * 2); // 3 days × 24 h × (min,max)
    const bucket = (b: number) => rgb(colored[b * 2]);
    expect(bucket(0)).not.toEqual(bucket(23)); // gradient within day 0
    expect(bucket(24)).not.toEqual(bucket(0)); // day boundary → different base
  });
});
