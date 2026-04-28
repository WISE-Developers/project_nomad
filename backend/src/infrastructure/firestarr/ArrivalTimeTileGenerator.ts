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

/** Green (hue 120) → red (hue 0) HSL ramp across `total` buckets. */
function rampColor(index: number, total: number): [number, number, number] {
  const t = total <= 1 ? 0 : index / (total - 1);
  const hue = 120 - t * 120;
  const s = 0.9;
  const l = 0.5;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (hue < 60)      [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else                [r, g, b] = [c, 0, x];
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

/**
 * Build a gdaldem color-relief table that paints each classification bucket
 * as a discrete band (start and end of bucket share the same color; a small
 * epsilon gap before the next bucket prevents interpolation).
 */
export function buildArrivalColorTable(
  offsetDay: number,
  endJulian: number,
  timestep: ArrivalTimestep,
): string {
  const spanDays = Math.max(0, endJulian - offsetDay);
  const bucketCount =
    timestep === 'daily'
      ? Math.max(1, Math.ceil(spanDays))
      : Math.max(1, Math.ceil(spanDays * 24));
  const step = timestep === 'daily' ? 1 : 1 / 24;
  const epsilon = step * 0.001;

  const lines: string[] = ['0 0 0 0 0'];
  for (let i = 0; i < bucketCount; i++) {
    const [r, g, b] = rampColor(i, bucketCount);
    const bucketMin = offsetDay + i * step;
    const bucketMax = offsetDay + (i + 1) * step - epsilon;
    lines.push(`${bucketMin.toFixed(8)} ${r} ${g} ${b} 220`);
    lines.push(`${bucketMax.toFixed(8)} ${r} ${g} ${b} 220`);
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
): Promise<Buffer | null> {
  const cacheKey = `arrival:${filePath}:${offsetDay}:${endJulian}:${timestep}:${z}:${x}:${y}`;
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

    const colorTable = buildArrivalColorTable(offsetDay, endJulian, timestep);
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
