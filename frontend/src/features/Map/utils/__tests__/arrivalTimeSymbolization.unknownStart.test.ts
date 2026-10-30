/**
 * #482 — the arrival legend when the start INSTANT was never recorded.
 *
 * Franco's ruling, 2026-10-30, option (a): show relative "Day 1 / Day 2"
 * labels. No calendar dates, and above all no substituted date.
 *
 * WHAT WAS THERE BEFORE. `App.tsx` read
 * `String(output.metadata?.startDate ?? new Date().toISOString())`, so a run
 * with no recorded start was labelled with TODAY — a 2023 reconstruction
 * rendering as 2026, in the one field that tells an analyst which fuel vintage
 * and which fire season they are looking at. Deleting the backend's invented
 * year (#479, half 1) without this would only have relocated the lie one layer
 * up, which is why the branch was held from merging.
 *
 * WHY `startDate` CANNOT SIMPLY BE DROPPED. In `generateArrivalLegend` it does
 * TWO jobs, and the second is the reason this is a product decision rather than
 * a deletion:
 *
 *   1. `ignitionJulian` — the sub-day ignition fraction, which drops bins
 *      entirely before ignition.
 *   2. `startDayMs` — and EVERY calendar label comes from it
 *      (`bucketDate = startDayMs + i * step * MS_PER_DAY`). There is no second
 *      source for a label; verified by reading every use inside the function.
 *
 * So with no start instant there is no honest calendar label, and the legend
 * falls back to the one thing it does know: which day of the model each bin is.
 * `startJulian`/`endJulian` are integers already present in the metadata and
 * are not derived from the start date.
 *
 * NO IGNITION FILTERING EITHER, and that is deliberate rather than an
 * oversight. Dropping pre-ignition bins requires knowing the ignition instant.
 * Not dropping any shows every bin the raster actually contains. The
 * alternative — treating the ignition as midnight so the filter "works" — is
 * precisely the invented value this issue exists to remove, and it would be
 * invisible once constructed.
 */
import { describe, it, expect } from 'vitest';
import { generateArrivalLegend } from '../arrivalTimeSymbolization';

const KNOWN_START = new Date(Date.UTC(2026, 5, 19)); // June 19 2026 = day 170

describe('#482 — arrival legend with no recorded start instant', () => {
  describe('the controls', () => {
    it('a KNOWN start still produces calendar labels — the positive control', () => {
      // Without this, every "no date in the label" assertion below could be
      // passing because the function stopped producing labels at all.
      const legend = generateArrivalLegend({
        startJulian: 170,
        endJulian: 173,
        timestep: 'daily',
        startDate: KNOWN_START,
      });

      expect(legend).toHaveLength(3);
      expect(legend[0].label).toContain('Jun');
      expect(legend[0].label).toContain('2026');
    });
  });

  it('labels bins by relative day when startDate is absent', () => {
    const legend = generateArrivalLegend({
      startJulian: 170,
      endJulian: 173,
      timestep: 'daily',
    });

    expect(legend).toHaveLength(3);
    expect(legend[0].label).toBe('Day 1');
    expect(legend[1].label).toBe('Day 2');
    expect(legend[2].label).toBe('Day 3');
  });

  it('never puts a month, a year or a date in the label', () => {
    // The assertion that would have caught the old behaviour. Today's date
    // appearing anywhere in here is the defect.
    const legend = generateArrivalLegend({
      startJulian: 170,
      endJulian: 175,
      timestep: 'daily',
    });

    for (const entry of legend) {
      expect(entry.label).toMatch(/^Day \d+$/);
      expect(entry.label).not.toMatch(/\d{4}/); // no year
      expect(entry.label).not.toMatch(/Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/);
    }
  });

  it('labels hourly bins by relative day and hour offset', () => {
    // The hourly view still has to say something per bin. Hours since the
    // start of the model day are known; a clock time is not.
    const legend = generateArrivalLegend({
      startJulian: 170,
      endJulian: 171,
      timestep: 'hourly',
      breaksPerDay: 24,
    });

    expect(legend).toHaveLength(24);
    expect(legend[0].label).toBe('Day 1 +00h');
    expect(legend[1].label).toBe('Day 1 +01h');
    expect(legend[23].label).toBe('Day 1 +23h');
  });

  it('continues the day counter across days in the hourly view', () => {
    const legend = generateArrivalLegend({
      startJulian: 170,
      endJulian: 172,
      timestep: 'hourly',
      breaksPerDay: 24,
    });

    expect(legend).toHaveLength(48);
    expect(legend[24].label).toBe('Day 2 +00h');
    expect(legend[47].label).toBe('Day 2 +23h');
  });

  it('drops NO bins — a filter needs an ignition instant we do not have', () => {
    // With a known start of midnight-plus-nothing the function would keep all
    // bins anyway, so the discriminating case is a model whose first bin would
    // be dropped IF an ignition time were assumed. Here none is, so the full
    // Julian window survives and the first bin starts exactly at startJulian.
    const legend = generateArrivalLegend({
      startJulian: 170,
      endJulian: 173,
      timestep: 'daily',
    });

    expect(legend).toHaveLength(3);
    expect(legend[0].minJulian).toBe(170);
    expect(legend[0].maxJulian).toBe(171);
    expect(legend[2].maxJulian).toBe(173);
  });

  it('keeps the Julian bounds identical to the known-start case', () => {
    // Only the LABELS change when the start instant is unknown. The geometry of
    // the bins is driven by startJulian/endJulian, which are integers in the
    // metadata and owe nothing to the start date. A drift here would mean the
    // legend and the server-rendered tiles disagree about bucket boundaries.
    const known = generateArrivalLegend({
      startJulian: 170,
      endJulian: 173,
      timestep: 'daily',
      startDate: KNOWN_START,
    });
    const unknown = generateArrivalLegend({
      startJulian: 170,
      endJulian: 173,
      timestep: 'daily',
    });

    expect(unknown.map((e) => [e.bucket, e.minJulian, e.maxJulian])).toEqual(
      known.map((e) => [e.bucket, e.minJulian, e.maxJulian]),
    );
  });

  it('keeps the colours identical to the known-start case', () => {
    // Colour keying comes from the integer day index, not the date. An analyst
    // comparing two fires should not see different colours because one of them
    // happens to have recorded its start.
    const known = generateArrivalLegend({
      startJulian: 170,
      endJulian: 175,
      timestep: 'daily',
      startDate: KNOWN_START,
    });
    const unknown = generateArrivalLegend({
      startJulian: 170,
      endJulian: 175,
      timestep: 'daily',
    });

    expect(unknown.map((e) => e.color)).toEqual(known.map((e) => e.color));
    expect(unknown.map((e) => e.baseColor)).toEqual(known.map((e) => e.baseColor));
  });

  it('day numbering starts at 1 regardless of the Julian day', () => {
    // "Day 1" is the first day of THIS model, not day-of-year. Asserted with a
    // January model so a leftover dayOfYear would show up as "Day 5".
    const legend = generateArrivalLegend({
      startJulian: 5,
      endJulian: 7,
      timestep: 'daily',
    });

    expect(legend[0].label).toBe('Day 1');
    expect(legend[1].label).toBe('Day 2');
  });
});
