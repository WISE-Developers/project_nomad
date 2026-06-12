/**
 * Generates colored PNG tiles from FireSTARR arrival-time rasters, classified
 * at a user-selected timestep (daily / hourly).
 *
 * The arrival TIF stores Julian-day fractions per pixel. Rather than encoding
 * raw values and symbolizing client-side (MapLibre GL 5.3 has no `raster-color`
 * paint property), we build a gdaldem color-relief table dynamically based on
 * the requested timestep and render the tile with discrete color bands — the
 * same pipeline used for probability tiles. A green → red HSL ramp runs across
 * all buckets in the model window.
 *
 * Issue #226.
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { getRasterBounds } from './ContourGenerator.js';

const TILE_SIZE = 256;
const tileCache: Map<string, Buffer | null> = new Map();

export type ArrivalTimestep = 'hourly' | 'daily';

export interface ArrivalTifInfo {
  /** Highest-Julian-day file — the most complete cumulative view */
  filePath: string;
  /** First Julian day (classification origin) */
  offsetDay: number;
  /** Last Julian day + 1 (end of model window) */
  endJulian: number;
  /** All discovered Julian days, ascending */
  julianDays: number[];
}

export function clearArrivalTileCache(): void {
  tileCache.clear();
}

export function findArrivalTifs(workingDir: string): ArrivalTifInfo | null {
  if (!existsSync(workingDir)) return null;
  const files = readdirSync(workingDir);
  const matches: Array<{ filename: string; julianDay: number }> = [];
  for (const filename of files) {
    const m = filename.match(/^000_000001_(\d+)_arrival\.tif$/);
    if (m) matches.push({ filename, julianDay: parseInt(m[1], 10) });
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => a.julianDay - b.julianDay);
  const last = matches[matches.length - 1];
  return {
    filePath: join(workingDir, last.filename),
    offsetDay: matches[0].julianDay,
    endJulian: last.julianDay + 1,
    julianDays: matches.map((m) => m.julianDay),
  };
}

function tileToLon(tileX: number, zoom: number): number {
  return (tileX / Math.pow(2, zoom)) * 360 - 180;
}

function tileToLat(tileY: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * tileY) / Math.pow(2, zoom);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

// How far the intra-day gradient lightens/darkens the day base (0..1).
const INTRA_DAY_BLEND = 0.6;

// CB-safe, no-red sequential ramps (#271/#274). viridis is the default; the
// ColorBrewer presets and any custom uploaded ramp are selectable per layer.
// Kept BYTE-IDENTICAL to the frontend arrivalTimeSymbolization so rendered map
// pixels == legend swatches.
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

function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Invalid ramp colour: "${hex}" (expected #rrggbb)`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function resolveRamp(ramp?: string, customStops?: string[]): RGB[] {
  if (ramp === 'custom') {
    if (!customStops || customStops.length < 2) {
      throw new Error('A custom ramp needs at least two colour stops');
    }
    return customStops.map(hexToRgb);
  }
  return RAMPS[ramp ?? DEFAULT_RAMP] ?? RAMPS[DEFAULT_RAMP];
}

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

/**
 * Day-keyed colour for a classification bucket (#274): each whole day is a
 * distinct ramp base; for hourly, the sub-bins within a day are a light→dark
 * gradient of that base (bin 0 lightest, last darkest; midpoint = base).
 */
function bucketColor(
  dayIndex: number,
  totalDays: number,
  subBin: number,
  binsPerDay: number,
  stops: RGB[],
  overrides?: Record<number, string>,
): RGB {
  const base = dayBaseRgb(dayIndex, totalDays, stops, overrides);
  if (binsPerDay <= 1) return base.map((c) => Math.round(c)) as RGB;
  const f = subBin / (binsPerDay - 1);
  const amt = 0.5 - f; // >0 lighten toward white, <0 darken toward black
  const adj = base.map((c) =>
    amt >= 0 ? c + (255 - c) * amt * INTRA_DAY_BLEND : c * (1 + amt * INTRA_DAY_BLEND),
  );
  return [Math.round(adj[0]), Math.round(adj[1]), Math.round(adj[2])];
}

/**
 * Build a gdaldem color-relief table that paints each classification bucket
 * as a discrete band (start and end of bucket share the same color; a small
 * epsilon gap before the next bucket prevents interpolation).
 *
 * `offsetDay`/`endJulian` are 1-indexed Julian (matching filenames and
 * `dayOfYear`). FireSTARR writes 0-indexed Julian values inside the raster
 * (Jan 1 = 0.0), so thresholds shift down by 1 to land in raster-value
 * space — same convention as `toFireSTARRRasterJulianDay` in
 * arrivalAnimation.ts (refs #253, #261).
 */
export interface ArrivalColorOptions {
  /** Sub-buckets per day for the hourly view (#271 Unit 8). Default 24 (hourly). */
  breaksPerDay?: number;
  /** Colour-ramp preset key (#271 Unit 9), e.g. 'viridis' | 'YlGnBu' | 'custom'. */
  ramp?: string;
  /** Custom ramp colour stops (hex) when `ramp === 'custom'` (#271 Unit 9). */
  customStops?: string[];
  /** Per-day base-colour overrides keyed by day index (#271 Unit 7). */
  dayColorOverrides?: Record<number, string>;
  /**
   * Bin indices to keep opaque (#272 Unit 6). When non-empty, every other bin
   * is dimmed so the clicked bins stand out. Empty/undefined = all opaque.
   */
  highlightBuckets?: number[];
}

const FULL_ALPHA = 220;
const DIM_ALPHA = 55;

export function buildArrivalColorTable(
  offsetDay: number,
  endJulian: number,
  timestep: ArrivalTimestep,
  opts: ArrivalColorOptions = {},
): string {
  const spanDays = Math.max(0, endJulian - offsetDay);
  // The number of Julian days drives the number of distinct day base colours
  // (#274); each day is sub-divided into `breaksPerDay` gradient bins (#271).
  const totalDays = Math.max(1, Math.ceil(spanDays));
  const stops = resolveRamp(opts.ramp, opts.customStops);
  const binsPerDay =
    timestep === 'daily' ? 1 : Math.max(1, Math.floor(opts.breaksPerDay ?? 24));
  const bucketCount = totalDays * binsPerDay;
  const step = timestep === 'daily' ? 1 : 1 / binsPerDay;
  const epsilon = step * 0.001;
  const rasterOffset = offsetDay - 1;

  const highlight = new Set(opts.highlightBuckets ?? []);
  const lines: string[] = ['0 0 0 0 0'];
  for (let i = 0; i < bucketCount; i++) {
    const dayIndex = Math.floor(i / binsPerDay);
    const subBin = i % binsPerDay;
    const [r, g, b] = bucketColor(dayIndex, totalDays, subBin, binsPerDay, stops, opts.dayColorOverrides);
    const a = highlight.size === 0 || highlight.has(i) ? FULL_ALPHA : DIM_ALPHA;
    const bucketMin = rasterOffset + i * step;
    const bucketMax = rasterOffset + (i + 1) * step - epsilon;
    lines.push(`${bucketMin.toFixed(8)} ${r} ${g} ${b} ${a}`);
    lines.push(`${bucketMax.toFixed(8)} ${r} ${g} ${b} ${a}`);
  }
  lines.push('nv 0 0 0 0');
  return lines.join('\n');
}

/**
 * Render a single Web Mercator tile for an arrival-time raster, colored by
 * classification timestep (daily or hourly).
 */
export async function generateArrivalTile(
  filePath: string,
  offsetDay: number,
  endJulian: number,
  timestep: ArrivalTimestep,
  z: number,
  x: number,
  y: number,
  opts: ArrivalColorOptions = {},
): Promise<Buffer | null> {
  const optKey =
    `b${opts.breaksPerDay ?? ''}:r${opts.ramp ?? ''}:${(opts.customStops ?? []).join('-')}` +
    `:d${Object.entries(opts.dayColorOverrides ?? {}).map(([k, v]) => `${k}=${v}`).join('-')}` +
    `:h${(opts.highlightBuckets ?? []).join('-')}`;
  const cacheKey = `arrival:${filePath}:${offsetDay}:${endJulian}:${timestep}:${optKey}:${z}:${x}:${y}`;
  const cached = tileCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const tempId = randomUUID().slice(0, 8);
  const workDir = mkdtempSync(join(tmpdir(), `nomad-arrival-tile-${tempId}-`));
  const vrtPath = join(workDir, 'tile.vrt');
  const colorTablePath = join(workDir, 'colors.txt');
  const outPng = join(workDir, 'tile.png');

  try {
    const west = tileToLon(x, z);
    const east = tileToLon(x + 1, z);
    const north = tileToLat(y, z);
    const south = tileToLat(y + 1, z);

    const lonBuffer = (east - west) / TILE_SIZE;
    const latBuffer = (north - south) / TILE_SIZE;

    const rasterBounds = await getRasterBounds(filePath);
    if (
      east < rasterBounds[0] ||
      west > rasterBounds[2] ||
      north < rasterBounds[1] ||
      south > rasterBounds[3]
    ) {
      tileCache.set(cacheKey, null);
      return null;
    }

    execSync(
      `gdalwarp -t_srs EPSG:4326 ` +
        `-te ${west - lonBuffer} ${south - latBuffer} ${east + lonBuffer} ${north + latBuffer} ` +
        `-ts ${TILE_SIZE} ${TILE_SIZE} -r near -srcnodata 0 -dstnodata 0 -of VRT ` +
        `"${filePath}" "${vrtPath}"`,
      { stdio: 'pipe' },
    );

    if (!existsSync(vrtPath)) {
      tileCache.set(cacheKey, null);
      return null;
    }

    const colorTable = buildArrivalColorTable(offsetDay, endJulian, timestep, opts);
    writeFileSync(colorTablePath, colorTable);

    execSync(
      `gdaldem color-relief "${vrtPath}" "${colorTablePath}" "${outPng}" -of PNG -alpha`,
      { stdio: 'pipe' },
    );

    if (!existsSync(outPng)) {
      tileCache.set(cacheKey, null);
      return null;
    }

    const buffer = readFileSync(outPng);
    tileCache.set(cacheKey, buffer);
    return buffer;
  } catch (err) {
    console.error(`[ArrivalTileGenerator] Error z=${z} x=${x} y=${y}:`, err);
    tileCache.set(cacheKey, null);
    return null;
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
}
