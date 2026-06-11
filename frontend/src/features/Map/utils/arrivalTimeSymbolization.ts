/**
 * Pure symbolization utilities for FireSTARR arrival-time rasters.
 *
 * The arrival TIF stores Julian-day fractions and is served to the client
 * as an RGB-encoded PNG tile (see backend ArrivalTimeEncoder for encoding).
 * These helpers classify decoded values into timestep buckets, build the
 * dynamic legend, and produce the MapLibre `raster-color` paint expression.
 *
 * Issue #226.
 */

export type Timestep = 'hourly' | 'daily';

export interface ArrivalLegendEntry {
  bucket: number;
  /** 0-based day index relative to the start day (#274). */
  dayIndex: number;
  label: string;
  /** Rendered swatch colour (base for daily, intra-day gradient for hourly). */
  color: string;
  /** The day's distinct base colour; shared by every hour within that day. */
  baseColor: string;
  minJulian: number;
  maxJulian: number;
}

export interface GenerateLegendOptions {
  startJulian: number;
  endJulian: number;
  timestep: Timestep;
  startDate: Date;
}

const MS_PER_DAY = 86_400_000;

export function bucketOf(
  julianDay: number,
  startJulian: number,
  timestep: Timestep,
): number {
  if (!Number.isFinite(julianDay) || julianDay === 0) return -1;
  if (julianDay < startJulian) return -1;
  // Key on the integer Julian DAY, not the fractional ignition time (#274),
  // so day colours break at the Julian-day boundary (midnight) and 23:59
  // bins with that day — per Den-Boychuk + jordan-evens on the issue.
  const startDay = Math.floor(startJulian);
  const daysSince = julianDay - startDay;
  const FP_EPSILON = 1e-9;
  return timestep === 'daily'
    ? Math.floor(daysSince + FP_EPSILON)
    : Math.floor(daysSince * 24 + FP_EPSILON);
}

export function generateArrivalLegend(
  opts: GenerateLegendOptions,
): ArrivalLegendEntry[] {
  const { startJulian, endJulian, timestep, startDate } = opts;
  // Day colours break on the integer Julian DAY (#274): the number of Julian
  // days the model spans drives the number of distinct base colours, and bins
  // align to the Julian-day grid (midnight) rather than the ignition time.
  const startDay = Math.floor(startJulian);
  const totalDays = Math.max(1, Math.ceil(endJulian) - startDay);
  const step = timestep === 'daily' ? 1 : 1 / HOURS_PER_DAY;
  const binsPerDay = timestep === 'daily' ? 1 : HOURS_PER_DAY;
  const totalBins = totalDays * binsPerDay;

  // Midnight (UTC) of the start day, so day bins align to the Julian-day grid
  // and labels land on real clock boundaries. The ignition time-of-day lives in
  // startDate; derive the actual ignition Julian so we can drop pre-ignition bins.
  const startDayMs = Date.UTC(
    startDate.getUTCFullYear(),
    startDate.getUTCMonth(),
    startDate.getUTCDate(),
  );
  const ignitionJulian = startDay + (startDate.getTime() - startDayMs) / MS_PER_DAY;

  const entries: ArrivalLegendEntry[] = [];
  for (let i = 0; i < totalBins; i++) {
    const binStart = startDay + i * step;
    const maxJulian = startDay + (i + 1) * step;
    if (maxJulian <= ignitionJulian) continue; // drop bins entirely before ignition
    if (binStart >= endJulian) break; // past the data window
    const minJulian = Math.max(binStart, ignitionJulian);
    const dayIndex = Math.floor(binStart + 1e-9) - startDay;
    const baseColor = dayBaseColor(dayIndex, totalDays);
    const clockHour =
      Math.round((binStart - Math.floor(binStart)) * HOURS_PER_DAY) % HOURS_PER_DAY;
    const color =
      timestep === 'daily'
        ? baseColor
        : hourColor(dayIndex, totalDays, clockHour);
    const bucketDate = new Date(startDayMs + i * step * MS_PER_DAY);
    const label =
      timestep === 'daily'
        ? formatDailyLabel(bucketDate)
        : formatHourlyLabel(bucketDate);
    entries.push({
      bucket: entries.length,
      dayIndex,
      label,
      color,
      baseColor,
      minJulian,
      maxJulian,
    });
  }
  return entries;
}

function formatDailyLabel(date: Date): string {
  return date.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatHourlyLabel(date: Date): string {
  const month = date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${month} ${hh}:${mm}`;
}

const HOURS_PER_DAY = 24;
// How far the intra-day gradient lightens/darkens the day base (0..1).
const INTRA_DAY_BLEND = 0.6;

// viridis control points (CB- and greyscale-safe; no red — see #271/#274).
// Sampled at t = 0, 0.25, 0.5, 0.75, 1.0. Kept byte-identical to the backend
// ArrivalTimeTileGenerator so legend swatches == rendered map pixels.
type RGB = [number, number, number];
const VIRIDIS_STOPS: RGB[] = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37],
];

function viridis(t: number): RGB {
  const tt = Math.max(0, Math.min(1, t));
  const seg = tt * 4;
  const i = Math.min(Math.floor(seg), 3);
  const f = seg - i;
  const a = VIRIDIS_STOPS[i];
  const b = VIRIDIS_STOPS[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

function rgbToHex([r, g, b]: RGB): string {
  const toHex = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** viridis sample for a day, spread across the model's day count (#274). */
function dayBaseRgb(dayIndex: number, totalDays: number): RGB {
  return viridis(totalDays <= 1 ? 0 : dayIndex / (totalDays - 1));
}

/** A day's distinct base colour — shared by every hour within that day (#274). */
function dayBaseColor(dayIndex: number, totalDays: number): string {
  return rgbToHex(dayBaseRgb(dayIndex, totalDays));
}

/**
 * Light → dark gradient of a day's base across the hours of that day (#274).
 * hour 0 = lightest (start of day), hour 23 = darkest (end of day); the
 * midpoint reproduces the day base, so daily and hourly stay consistent.
 */
function hourColor(dayIndex: number, totalDays: number, clockHour: number): string {
  const base = dayBaseRgb(dayIndex, totalDays);
  const f = HOURS_PER_DAY <= 1 ? 0.5 : clockHour / (HOURS_PER_DAY - 1);
  const amt = 0.5 - f; // >0 lighten toward white, <0 darken toward black
  const adj: RGB =
    amt >= 0
      ? [
          base[0] + (255 - base[0]) * amt * INTRA_DAY_BLEND,
          base[1] + (255 - base[1]) * amt * INTRA_DAY_BLEND,
          base[2] + (255 - base[2]) * amt * INTRA_DAY_BLEND,
        ]
      : [
          base[0] * (1 + amt * INTRA_DAY_BLEND),
          base[1] * (1 + amt * INTRA_DAY_BLEND),
          base[2] * (1 + amt * INTRA_DAY_BLEND),
        ];
  return rgbToHex(adj);
}
