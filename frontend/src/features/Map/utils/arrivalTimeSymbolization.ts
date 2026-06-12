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
  /**
   * Earliest fire's integer start day, for multi-fire colour alignment (#274
   * Unit 5). When several arrival layers are shown, keying every layer's day
   * colours to a shared origin makes "day N" the same colour across all fires.
   * Defaults to this layer's own start day (single-fire behaviour).
   */
  originDay?: number;
  /**
   * Total day span across all aligned fires, used as the colour-ramp
   * denominator so the viridis spread matches between fires. Defaults to this
   * layer's own span.
   */
  totalDaysOverride?: number;
  /**
   * Sub-buckets per day for the hourly view (#271 Unit 8). Default 24 (hourly).
   * Kept in lockstep with the backend tile renderer's `breaksPerDay`.
   */
  breaksPerDay?: number;
  /**
   * Colour-ramp preset key (#271 Unit 9), e.g. 'viridis' | 'YlGnBu' | 'custom'.
   * Defaults to viridis. Kept in lockstep with the backend renderer.
   */
  ramp?: string;
  /** Custom ramp colour stops (hex) when `ramp === 'custom'` (#271 Unit 9). */
  customStops?: string[];
  /** Per-day base-colour overrides keyed by day index (#271 Unit 7). */
  dayColorOverrides?: Record<number, string>;
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
  const {
    startJulian,
    endJulian,
    timestep,
    startDate,
    originDay,
    totalDaysOverride,
    breaksPerDay,
    ramp,
    customStops,
    dayColorOverrides,
  } = opts;
  const stops = resolveRamp(ramp, customStops);
  // Day colours break on the integer Julian DAY (#274): the number of Julian
  // days the model spans drives the number of distinct base colours, and bins
  // align to the Julian-day grid (midnight) rather than the ignition time.
  const startDay = Math.floor(startJulian);
  const localTotalDays = Math.max(1, Math.ceil(endJulian) - startDay);
  // Colour keying may be shared across fires (#274 Unit 5): a shared origin day
  // + span makes "day N" the same colour across every visible arrival layer.
  const colourOrigin = originDay ?? startDay;
  const colourTotalDays = totalDaysOverride ?? localTotalDays;
  const binsPerDay =
    timestep === 'daily' ? 1 : Math.max(1, Math.floor(breaksPerDay ?? HOURS_PER_DAY));
  const step = timestep === 'daily' ? 1 : 1 / binsPerDay;
  const totalBins = localTotalDays * binsPerDay;

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
    const dayIndex = Math.floor(binStart + 1e-9) - colourOrigin;
    const baseColor = dayBaseColor(dayIndex, colourTotalDays, stops, dayColorOverrides);
    const subBin = i % binsPerDay;
    const color =
      timestep === 'daily'
        ? baseColor
        : hourColor(dayIndex, colourTotalDays, subBin, binsPerDay, stops, dayColorOverrides);
    const bucketDate = new Date(startDayMs + i * step * MS_PER_DAY);
    const label =
      timestep === 'daily'
        ? formatDailyLabel(bucketDate)
        : formatHourlyLabel(bucketDate);
    entries.push({
      // Absolute bin index (matches the backend colour-table bucket), so a
      // click-to-highlight (#272) targets the same bin server-side.
      bucket: i,
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

// CB-safe, no-red sequential ramps (#271/#274). viridis is the default; the
// ColorBrewer presets and any custom uploaded ramp are selectable per layer.
// Kept byte-identical to the backend ArrivalTimeTileGenerator so legend
// swatches == rendered map pixels.
type RGB = [number, number, number];
const RAMPS: Record<string, RGB[]> = {
  viridis: [
    [68, 1, 84],
    [59, 82, 139],
    [33, 145, 140],
    [94, 201, 98],
    [253, 231, 37],
  ],
  YlGnBu: [
    [255, 255, 204],
    [161, 218, 180],
    [65, 182, 196],
    [44, 127, 184],
    [37, 52, 148],
  ],
  BuGn: [
    [237, 248, 251],
    [178, 226, 226],
    [102, 194, 164],
    [44, 162, 95],
    [0, 109, 44],
  ],
  PuBu: [
    [241, 238, 246],
    [189, 201, 225],
    [116, 169, 207],
    [43, 140, 190],
    [4, 90, 141],
  ],
};
const DEFAULT_RAMP = 'viridis';
/** Preset ramp keys exposed in the legend's ramp picker (#271 Unit 9). */
export const ARRIVAL_RAMP_PRESETS = Object.keys(RAMPS);

function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Invalid ramp colour: "${hex}" (expected #rrggbb)`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Resolve the active ramp stops from a preset key or a custom hex list. */
function resolveRamp(ramp?: string, customStops?: string[]): RGB[] {
  if (ramp === 'custom') {
    if (!customStops || customStops.length < 2) {
      throw new Error('A custom ramp needs at least two colour stops');
    }
    return customStops.map(hexToRgb);
  }
  return RAMPS[ramp ?? DEFAULT_RAMP] ?? RAMPS[DEFAULT_RAMP];
}

/** Linear sample of an N-stop ramp at t ∈ [0,1]. */
function sampleRamp(stops: RGB[], t: number): RGB {
  if (stops.length === 1) return stops[0];
  const tt = Math.max(0, Math.min(1, t));
  const seg = tt * (stops.length - 1);
  const i = Math.min(Math.floor(seg), stops.length - 2);
  const f = seg - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

function rgbToHex([r, g, b]: RGB): string {
  const toHex = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * A day's base colour — a per-day override (#271 Unit 7) when present, else a
 * ramp sample spread across the model's day count (#274).
 */
function dayBaseRgb(
  dayIndex: number,
  totalDays: number,
  stops: RGB[],
  overrides?: Record<number, string>,
): RGB {
  const override = overrides?.[dayIndex];
  if (override) return hexToRgb(override);
  return sampleRamp(stops, totalDays <= 1 ? 0 : dayIndex / (totalDays - 1));
}

/** A day's distinct base colour — shared by every hour within that day (#274). */
function dayBaseColor(
  dayIndex: number,
  totalDays: number,
  stops: RGB[],
  overrides?: Record<number, string>,
): string {
  return rgbToHex(dayBaseRgb(dayIndex, totalDays, stops, overrides));
}

/**
 * Light → dark gradient of a day's base across the hours of that day (#274).
 * hour 0 = lightest (start of day), hour 23 = darkest (end of day); the
 * midpoint reproduces the day base, so daily and hourly stay consistent.
 */
function hourColor(
  dayIndex: number,
  totalDays: number,
  subBin: number,
  binsPerDay: number,
  stops: RGB[],
  overrides?: Record<number, string>,
): string {
  const base = dayBaseRgb(dayIndex, totalDays, stops, overrides);
  const f = binsPerDay <= 1 ? 0.5 : subBin / (binsPerDay - 1);
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
