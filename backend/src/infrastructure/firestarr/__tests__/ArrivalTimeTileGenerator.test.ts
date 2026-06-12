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
import {
  buildArrivalColorTable,
  buildArrivalPalette,
  valueToRgba,
} from '../ArrivalTimeTileGenerator.js';

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

describe('valueToRgba — in-process tile colouring (#283 perf)', () => {
  it('maps raster values to the matching bucket RGBA', () => {
    // 3-day viridis: rasterOffset 169 (0-indexed Julian), step 1
    const p = buildArrivalPalette(170, 173, 'daily', {});
    expect(valueToRgba(169.5, p)).toEqual([68, 1, 84, 220]); // day 0 (purple)
    expect(valueToRgba(170.5, p)).toEqual([33, 145, 140, 220]); // day 1 (teal)
    expect(valueToRgba(171.9, p)).toEqual([253, 231, 37, 220]); // day 2 (yellow)
  });

  it('returns transparent for NoData and out-of-range values', () => {
    const p = buildArrivalPalette(170, 173, 'daily', {});
    expect(valueToRgba(0, p)).toEqual([0, 0, 0, 0]); // NoData
    expect(valueToRgba(-5, p)).toEqual([0, 0, 0, 0]);
    expect(valueToRgba(500, p)).toEqual([0, 0, 0, 0]); // past last bucket
  });

  it('dims non-highlighted buckets in-process', () => {
    const p = buildArrivalPalette(170, 173, 'daily', { highlightBuckets: [1] });
    expect(valueToRgba(169.5, p)[3]).toBe(55); // day 0 dimmed
    expect(valueToRgba(170.5, p)[3]).toBe(220); // day 1 highlighted
  });

  it('shares the palette with the gdaldem colour table (same source)', () => {
    const p = buildArrivalPalette(170, 173, 'daily', { ramp: 'YlGnBu' });
    expect(p.colors[0].slice(0, 3)).toEqual([255, 255, 204]); // YlGnBu low
    expect(p.colors[2].slice(0, 3)).toEqual([37, 52, 148]); // YlGnBu high
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

  // #271 Unit 9 — selectable CB-safe ramps (no red); matches the frontend.
  it('honours the ramp option (YlGnBu)', () => {
    const colored = parseColorTable(
      buildArrivalColorTable(170, 173, 'daily', { ramp: 'YlGnBu' }),
    ).filter((e) => e.a === 220);
    expect(rgb(colored[0])).toEqual([255, 255, 204]);
    expect(rgb(colored[2])).toEqual([65, 182, 196]);
    expect(rgb(colored[4])).toEqual([37, 52, 148]);
  });

  it('honours a custom ramp via customStops', () => {
    const colored = parseColorTable(
      buildArrivalColorTable(170, 172, 'daily', { ramp: 'custom', customStops: ['#000000', '#ffffff'] }),
    ).filter((e) => e.a === 220);
    expect(rgb(colored[0])).toEqual([0, 0, 0]);
    expect(rgb(colored[2])).toEqual([255, 255, 255]);
  });

  // #272 Unit 6 — click-to-highlight: highlighted bins stay opaque, the rest dim.
  it('dims non-highlighted buckets when highlightBuckets is set', () => {
    const bins = parseColorTable(
      buildArrivalColorTable(170, 173, 'daily', { highlightBuckets: [1] }),
    ).filter((e) => e.a > 0); // bucket entries (drop the leading NoData a=0 row)
    expect(bins[0].a).toBeLessThan(220); // day 0 dimmed
    expect(bins[2].a).toBe(220); // day 1 highlighted
    expect(bins[4].a).toBeLessThan(220); // day 2 dimmed
  });

  it('leaves all buckets opaque when no highlight is set', () => {
    const bins = parseColorTable(buildArrivalColorTable(170, 173, 'daily')).filter((e) => e.a > 0);
    expect(bins.every((e) => e.a === 220)).toBe(true);
  });

  // #271 Unit 7 — per-day colour overrides (click a day swatch to recolour).
  it('honours per-day colour overrides', () => {
    const colored = parseColorTable(
      buildArrivalColorTable(170, 173, 'daily', { dayColorOverrides: { 1: '#ff8800' } }),
    ).filter((e) => e.a === 220);
    expect(rgb(colored[0])).toEqual([68, 1, 84]); // day 0 unchanged (viridis)
    expect(rgb(colored[2])).toEqual([255, 136, 0]); // day 1 recoloured
  });

  // #271 Unit 8 — temporal breaks slider: breaksPerDay sets the number of
  // sub-buckets within each day-colour (default 24 = hourly).
  it('honours breaksPerDay (6-hour breaks → 4 sub-buckets per day)', () => {
    const colored = parseColorTable(
      buildArrivalColorTable(170, 173, 'hourly', { breaksPerDay: 4 }),
    ).filter((e) => e.a === 220);
    expect(colored.length).toBe(3 * 4 * 2); // 3 days × 4 breaks × (min,max)
  });
});
