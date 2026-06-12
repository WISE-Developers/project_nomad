/**
 * arrivalTimeSymbolization — classify arrival-time pixels and build
 * a data-driven MapLibre `raster-color` expression from an RGB-encoded
 * arrival tile (see backend/ArrivalTimeEncoder for the encoding scheme).
 *
 * Issue #226 — one arrival grid, swappable symbolization by timestep (daily/hourly).
 */

import { describe, it, expect } from 'vitest';
import {
  bucketOf,
  generateArrivalLegend,
} from '../arrivalTimeSymbolization';

describe('arrivalTimeSymbolization', () => {
  describe('bucketOf', () => {
    it('returns 0 for the first day when timestep is "daily"', () => {
      expect(bucketOf(170.0, 170, 'daily')).toBe(0);
      expect(bucketOf(170.99, 170, 'daily')).toBe(0);
    });

    it('returns 1 for the second day when timestep is "daily"', () => {
      expect(bucketOf(171.0, 170, 'daily')).toBe(1);
      expect(bucketOf(171.5, 170, 'daily')).toBe(1);
    });

    it('returns correct bucket for hourly timestep', () => {
      expect(bucketOf(170.0, 170, 'hourly')).toBe(0);
      expect(bucketOf(170.0 + 1 / 24, 170, 'hourly')).toBe(1);
      expect(bucketOf(170.5, 170, 'hourly')).toBe(12);
      expect(bucketOf(171.0, 170, 'hourly')).toBe(24);
    });

    it('returns -1 (sentinel) for NaN / NoData', () => {
      expect(bucketOf(Number.NaN, 170, 'daily')).toBe(-1);
      expect(bucketOf(0, 170, 'daily')).toBe(-1);
    });

    it('returns -1 for values below the start', () => {
      expect(bucketOf(169.5, 170, 'daily')).toBe(-1);
    });

    // #274 — break on the integer Julian DAY, not 24h after a mid-day ignition.
    // Den-Boychuk: 23:59 bins with today; jordan-evens: subtract the start DAY.
    it('keys buckets on the integer Julian day, not the fractional ignition time', () => {
      // ignition at jd 148.75 (18:00). The day colour must change at the
      // Julian-day boundary (midnight), not 24h after ignition.
      expect(bucketOf(148.99, 148.75, 'daily')).toBe(0); // 23:45 of day 148 → day 0
      expect(bucketOf(149.0, 148.75, 'daily')).toBe(1); // midnight → day 1
      expect(bucketOf(149.99, 148.75, 'daily')).toBe(1);
      expect(bucketOf(150.0, 148.75, 'daily')).toBe(2);
    });
  });

  describe('generateArrivalLegend', () => {
    it('produces one entry per day for a 3-day model with "daily" timestep', () => {
      const legend = generateArrivalLegend({
        startJulian: 170,
        endJulian: 173,
        timestep: 'daily',
        startDate: new Date(Date.UTC(2026, 5, 19)), // June 19, 2026 = day 170
      });
      expect(legend).toHaveLength(3);
      expect(legend[0].bucket).toBe(0);
      expect(legend[2].bucket).toBe(2);
    });

    it('produces one entry per hour for a 3-day model with "hourly" timestep', () => {
      const legend = generateArrivalLegend({
        startJulian: 170,
        endJulian: 173,
        timestep: 'hourly',
        startDate: new Date(Date.UTC(2026, 5, 19)),
      });
      expect(legend).toHaveLength(72); // 3 days * 24 hours
      expect(legend[0].bucket).toBe(0);
      expect(legend[71].bucket).toBe(71);
    });

    it('renders daily labels with year and calendar date', () => {
      const legend = generateArrivalLegend({
        startJulian: 170,
        endJulian: 172,
        timestep: 'daily',
        startDate: new Date(Date.UTC(2026, 5, 19)),
      });
      expect(legend[0].label).toMatch(/jun.*19.*2026|2026.*jun.*19/i);
      expect(legend[1].label).toMatch(/jun.*20.*2026|2026.*jun.*20/i);
    });

    it('renders hourly labels with date and time', () => {
      const legend = generateArrivalLegend({
        startJulian: 170,
        endJulian: 171,
        timestep: 'hourly',
        startDate: new Date(Date.UTC(2026, 5, 19)),
      });
      expect(legend[0].label).toMatch(/jun.*19.*00:00/i);
      expect(legend[12].label).toMatch(/jun.*19.*12:00/i);
    });

    it('assigns colors across a ramp (first and last differ)', () => {
      const legend = generateArrivalLegend({
        startJulian: 170,
        endJulian: 175,
        timestep: 'daily',
        startDate: new Date(Date.UTC(2026, 5, 19)),
      });
      expect(legend[0].color).not.toEqual(legend[legend.length - 1].color);
    });

    it('every entry has minJulian / maxJulian bounds', () => {
      const legend = generateArrivalLegend({
        startJulian: 170,
        endJulian: 173,
        timestep: 'daily',
        startDate: new Date(Date.UTC(2026, 5, 19)),
      });
      expect(legend[0].minJulian).toBe(170);
      expect(legend[0].maxJulian).toBe(171);
      expect(legend[2].minJulian).toBe(172);
      expect(legend[2].maxJulian).toBe(173);
    });
  });

  // Issue #274 — days define distinct base colours; hours within a day are
  // light/dark gradients of that day's base, relative to the start day.
  describe('day-keyed colours (#274)', () => {
    const opts = (timestep: 'daily' | 'hourly') => ({
      startJulian: 148,
      endJulian: 151, // 3-day model
      timestep,
      startDate: new Date(Date.UTC(2026, 4, 28)),
    });

    it('tags every entry with a 0-based day index relative to the start day', () => {
      const legend = generateArrivalLegend(opts('hourly'));
      expect(legend[0].dayIndex).toBe(0);
      expect(legend[23].dayIndex).toBe(0); // 23:00 still bins with day 0, not the next
      expect(legend[24].dayIndex).toBe(1);
      expect(legend[71].dayIndex).toBe(2);
    });

    it('hourly: each whole day shares ONE base colour, and consecutive days differ', () => {
      const legend = generateArrivalLegend(opts('hourly'));
      const day0 = new Set(legend.slice(0, 24).map((e) => e.baseColor));
      const day1 = new Set(legend.slice(24, 48).map((e) => e.baseColor));
      expect(day0.size).toBe(1);
      expect(day1.size).toBe(1);
      expect([...day0][0]).not.toEqual([...day1][0]);
    });

    it('hourly: hours within a day form a gradient (endpoints differ) off a shared base', () => {
      const legend = generateArrivalLegend(opts('hourly'));
      expect(legend[0].baseColor).toEqual(legend[23].baseColor);
      expect(legend[0].color).not.toEqual(legend[23].color);
    });

    it('daily and hourly agree on each day base colour', () => {
      const daily = generateArrivalLegend(opts('daily'));
      const hourly = generateArrivalLegend(opts('hourly'));
      expect(daily[0].baseColor).toEqual(hourly[0].baseColor);
      expect(daily[1].baseColor).toEqual(hourly[24].baseColor);
      expect(daily[2].baseColor).toEqual(hourly[48].baseColor);
    });

    it('daily: a day entry colour IS its base colour', () => {
      const daily = generateArrivalLegend(opts('daily'));
      expect(daily[0].color).toEqual(daily[0].baseColor);
    });

    // #274 Unit 5 — multiple fires align day colours to the earliest fire's
    // start day (jordan-evens), so "day N" is the same colour across all fires.
    it('keys day colours to a shared origin/span so fires match (multi-fire)', () => {
      // Fire A: day 170, 3 days. Fire B: day 172, 2 days.
      // Shared origin = 170; shared span = ceil(174) - 170 = 4 days.
      const a = generateArrivalLegend({
        startJulian: 170,
        endJulian: 173,
        timestep: 'daily',
        startDate: new Date(Date.UTC(2026, 5, 19)),
        originDay: 170,
        totalDaysOverride: 4,
      });
      const b = generateArrivalLegend({
        startJulian: 172,
        endJulian: 174,
        timestep: 'daily',
        startDate: new Date(Date.UTC(2026, 5, 21)),
        originDay: 170,
        totalDaysOverride: 4,
      });
      expect(a[0].dayIndex).toBe(0); // Fire A starts at the origin
      expect(b[0].dayIndex).toBe(2); // Fire B starts 2 days after the origin
      // Absolute day 2 is owned by A (a[2]) and is B's first day (b[0]) — same colour.
      expect(b[0].baseColor).toBe(a[2].baseColor);
    });

    it('defaults to single-fire keying when no origin/span is given', () => {
      const solo = generateArrivalLegend({
        startJulian: 172,
        endJulian: 174,
        timestep: 'daily',
        startDate: new Date(Date.UTC(2026, 5, 21)),
      });
      expect(solo[0].dayIndex).toBe(0); // relative to itself
    });

    // #271 Unit 9 — selectable CB-safe ramps (no red); viridis is the default.
    it('supports alternate CB-safe ramps via the ramp option', () => {
      const opts3 = {
        startJulian: 170,
        endJulian: 173,
        timestep: 'daily' as const,
        startDate: new Date(Date.UTC(2026, 5, 19)),
      };
      expect(generateArrivalLegend(opts3)[0].baseColor).toBe('#440154'); // default viridis
      const y = generateArrivalLegend({ ...opts3, ramp: 'YlGnBu' });
      expect(y[0].baseColor).toBe('#ffffcc');
      expect(y[1].baseColor).toBe('#41b6c4');
      expect(y[2].baseColor).toBe('#253494');
    });

    it('supports a custom uploaded ramp via custom stops', () => {
      const legend = generateArrivalLegend({
        startJulian: 170,
        endJulian: 172,
        timestep: 'daily',
        startDate: new Date(Date.UTC(2026, 5, 19)),
        ramp: 'custom',
        customStops: ['#000000', '#ffffff'],
      });
      expect(legend[0].baseColor).toBe('#000000');
      expect(legend[1].baseColor).toBe('#ffffff');
    });

    // #271/#272 Unit 7 — click a day swatch to recolour that day; the hourly
    // gradient regenerates from the chosen base.
    it('applies per-day colour overrides; hourly gradient derives from the override', () => {
      const daily = generateArrivalLegend({
        startJulian: 170,
        endJulian: 173,
        timestep: 'daily',
        startDate: new Date(Date.UTC(2026, 5, 19)),
        dayColorOverrides: { 1: '#ff8800' },
      });
      expect(daily[0].baseColor).toBe('#440154'); // day 0 unchanged (viridis)
      expect(daily[1].baseColor).toBe('#ff8800'); // day 1 recoloured
      expect(daily[2].baseColor).toBe('#fde725'); // day 2 unchanged
      const hourly = generateArrivalLegend({
        startJulian: 170,
        endJulian: 173,
        timestep: 'hourly',
        startDate: new Date(Date.UTC(2026, 5, 19)),
        dayColorOverrides: { 1: '#ff8800' },
      });
      const day1 = hourly.filter((e) => e.dayIndex === 1);
      expect(day1.every((e) => e.baseColor === '#ff8800')).toBe(true);
      expect(day1[0].color).not.toBe(day1[day1.length - 1].color); // still a gradient
    });

    // #271 Unit 8 — breaks slider: breaksPerDay sub-divides each day-colour.
    it('honours breaksPerDay — 6-hour breaks give 4 bins per day', () => {
      const legend = generateArrivalLegend({
        startJulian: 170,
        endJulian: 173,
        timestep: 'hourly',
        startDate: new Date(Date.UTC(2026, 5, 19)),
        breaksPerDay: 4,
      });
      expect(legend).toHaveLength(3 * 4); // 3 days × 4 breaks
      // still day-keyed: bins 0-3 = day 0, bins 4-7 = day 1
      expect(legend[0].dayIndex).toBe(0);
      expect(legend[4].dayIndex).toBe(1);
      // gradient within a day (first vs last sub-bin differ, shared base)
      expect(legend[0].baseColor).toBe(legend[3].baseColor);
      expect(legend[0].color).not.toBe(legend[3].color);
    });

    it('uses the viridis ramp for day bases (no red — CB-safe default)', () => {
      const daily = generateArrivalLegend(opts('daily')); // 3-day model
      expect(daily[0].baseColor).toBe('#440154'); // viridis low — purple
      expect(daily[1].baseColor).toBe('#21918c'); // viridis mid — teal
      expect(daily[2].baseColor).toBe('#fde725'); // viridis high — yellow
    });

    it('breaks day colours on the Julian midnight even when ignition is mid-day', () => {
      // start day 170 (Jun 19), ignition at 18:00. startJulian is the integer
      // day; the 18:00 lives in startDate. Day 0 must end at jd 171.0 (midnight),
      // NOT 24h after ignition.
      const legend = generateArrivalLegend({
        startJulian: 170,
        endJulian: 173,
        timestep: 'hourly',
        startDate: new Date(Date.UTC(2026, 5, 19, 18, 0)), // 18:00 ignition
      });
      // first emitted bin is the ignition hour (jd 170.75 = 18:00), still day 0
      expect(legend[0].minJulian).toBeCloseTo(170.75, 6);
      expect(legend[0].dayIndex).toBe(0);
      // the bin starting at midnight (jd 171.0) is day 1
      const midnightBin = legend.find((e) => Math.abs(e.minJulian - 171.0) < 1e-6);
      expect(midnightBin?.dayIndex).toBe(1);
      // no day-0 bin extends past the Julian-day boundary
      const day0 = legend.filter((e) => e.dayIndex === 0);
      expect(Math.max(...day0.map((e) => e.maxJulian))).toBeCloseTo(171.0, 6);
    });
  });

});
