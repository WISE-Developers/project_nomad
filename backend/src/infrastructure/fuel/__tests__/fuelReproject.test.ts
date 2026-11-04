import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildFuelWarpArgs,
  utmEpsgForZone,
  assertClassDomainPreserved,
} from '../fuelReproject';

/**
 * #282 task 4 — reproject locally, nearest-neighbour, at an explicit resolution.
 *
 * WHY NOT THE SERVER. `outputCrs` works and is nearest-neighbour, but returns
 * the same pixel COUNT stretched over the reprojected extent: a 10 km request
 * came back at 132 m from a 100 m source (measured 2026-11-04). BadgerOnABike's
 * guidance on #282 is explicit - "Don't do it... The Fuels have rules sets that
 * would not be properly respected in a resample."
 *
 * The command BUILDER is pure and always tested. The actual warp needs GDAL,
 * which CI does not install (tests.yml has no gdal step), so those tests skip
 * explicitly rather than silently - a skip that looks like a pass is the thing
 * this whole issue keeps teaching.
 */
function gdalPresent(): boolean {
  try {
    execFileSync('gdalwarp', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const HAVE_GDAL = gdalPresent();
const SOURCE = join(__dirname, 'fixtures', 'fuel_3978_20km.tif');

describe('utmEpsgForZone', () => {
  it('maps a northern UTM zone to its EPSG code', () => {
    expect(utmEpsgForZone(11)).toBe(32611);
    expect(utmEpsgForZone(7)).toBe(32607);
  });

  it('refuses a zone outside 1-60 rather than composing a plausible EPSG', () => {
    // 32600 + 0 and 32600 + 61 are both syntactically fine and neither is a UTM
    // zone, so a bad zone would produce a confident reprojection to nowhere.
    expect(() => utmEpsgForZone(0)).toThrow(/zone/i);
    expect(() => utmEpsgForZone(61)).toThrow(/zone/i);
    expect(() => utmEpsgForZone(11.5)).toThrow(/zone/i);
  });
});

describe('buildFuelWarpArgs', () => {
  const base = { sourcePath: '/in/fuel.tif', targetPath: '/out/fuel_utm.tif', utmZone: 11, resolutionM: 100 };

  it('warps to the zone EPSG at the requested cell size', () => {
    const args = buildFuelWarpArgs(base);
    expect(args).toContain('-t_srs');
    expect(args[args.indexOf('-t_srs') + 1]).toBe('EPSG:32611');
    expect(args).toContain('-tr');
    expect(args.slice(args.indexOf('-tr') + 1, args.indexOf('-tr') + 3)).toEqual(['100', '100']);
    expect(args.slice(-2)).toEqual(['/in/fuel.tif', '/out/fuel_utm.tif']);
  });

  it('resamples NEAREST, and never a blending kernel', () => {
    const args = buildFuelWarpArgs(base);
    expect(args[args.indexOf('-r') + 1]).toBe('near');
    // Pinned absence. A blending kernel on a classified raster averages fuel
    // CODES - 101 and 102 average to 101.5, and 650 against 102 to 376 - which
    // are not fuels at all. Proven by mutation, not assumed.
    const joined = args.join(' ');
    expect(joined).not.toMatch(/bilinear|cubic|average|lanczos|mode/);
  });

  it('refuses a resolution that is absent or not positive', () => {
    // A silent default here would quietly change the grid a fire model runs on.
    expect(() => buildFuelWarpArgs({ ...base, resolutionM: 0 })).toThrow(/resolution/i);
    expect(() => buildFuelWarpArgs({ ...base, resolutionM: -100 })).toThrow(/resolution/i);
  });
});

describe('assertClassDomainPreserved', () => {
  it('accepts a subset: reprojection may drop edge classes but never add', () => {
    expect(() => assertClassDomainPreserved([1, 2, 650], [1, 650])).not.toThrow();
    expect(() => assertClassDomainPreserved([1, 2, 650], [1, 2, 650])).not.toThrow();
  });

  it('REJECTS an invented class, naming it', () => {
    // 376 is what you get averaging 650 and 102. It is not a fuel.
    expect(() => assertClassDomainPreserved([102, 650], [102, 376, 650])).toThrow(/376/);
  });
});

describe.skipIf(!HAVE_GDAL)('reprojecting a real fuel grid with GDAL', () => {
  function census(path: string): number[] {
    const asc = `${path}.asc`;
    execFileSync('gdal_translate', ['-q', '-of', 'AAIGrid', path, asc], { stdio: 'ignore' });
    const text = readFileSync(asc, 'utf8');
    const values = new Set<number>();
    for (const line of text.split('\n')) {
      const tokens = line.trim().split(/\s+/);
      if (tokens.length === 0 || Number.isNaN(Number(tokens[0]))) continue;
      for (const t of tokens) values.add(Math.trunc(Number(t)));
    }
    return [...values].sort((a, b) => a - b);
  }

  it('keeps the class domain and the requested cell size', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fuelwarp-'));
    try {
      const out = join(dir, 'utm.tif');
      execFileSync('gdalwarp', buildFuelWarpArgs({
        sourcePath: SOURCE, targetPath: out, utmZone: 11, resolutionM: 100,
      }), { stdio: 'ignore' });
      expect(existsSync(out)).toBe(true);

      const before = census(SOURCE);
      const after = census(out);
      expect(before.length).toBeGreaterThan(5);
      assertClassDomainPreserved(before, after);

      const info = execFileSync('gdalinfo', [out], { encoding: 'utf8' });
      expect(info).toMatch(/Pixel Size = \(100\.0+,-100\.0+\)/);
      expect(info).toMatch(/32611/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('CONTROL: a bilinear warp invents classes, so the domain check can fail', () => {
    // Without this, "the domain was preserved" might only mean the check is
    // incapable of failing on real data. This proves the opposite kernel breaks
    // it - the assertion is live.
    const dir = mkdtempSync(join(tmpdir(), 'fuelwarp-bad-'));
    try {
      const out = join(dir, 'bilinear.tif');
      const args = buildFuelWarpArgs({
        sourcePath: SOURCE, targetPath: out, utmZone: 11, resolutionM: 100,
      });
      const bad = args.map((a, i) => (args[i - 1] === '-r' ? 'bilinear' : a));
      execFileSync('gdalwarp', bad, { stdio: 'ignore' });
      const before = census(SOURCE);
      const after = census(out);
      expect(() => assertClassDomainPreserved(before, after)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
