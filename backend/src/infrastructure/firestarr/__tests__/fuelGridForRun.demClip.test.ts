import { describe, it, expect, vi, type Mock } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { resolveFuelGridForRun, type FuelGridForRunDeps } from '../fuelGridForRun.js';
import { buildDemClipArgs } from '../../fuel/fuelReproject.js';

/**
 * #563 Step 2: A CO-REGISTERED DEM MUST SIT IN THE PER-RUN RASTER ROOT.
 *
 * Handed a root containing fuel alone, FireSTARR exits 139 with no FATAL line, no log
 * file and zero bytes on stdout and stderr. That silence is the dangerous part — it is
 * indistinguishable from a crash for any other reason, so nothing about the failure
 * points at the missing DEM. Fuel and DEM at DIFFERENT extents instead gives
 * `FATAL: Grids are not aligned`; at identical origin and size that message disappears.
 *
 * So "a DEM is present" is not the requirement. The requirement is IDENTICAL ORIGIN,
 * CELL SIZE AND PIXEL DIMENSIONS, and that is what these tests assert.
 *
 * THE OPPOSITE KERNELS ARE DELIBERATE AND ARE ASSERTED TOGETHER BELOW. Fuel is a
 * CLASSIFIED raster and must be resampled NEAREST, always — averaging fuel codes
 * produces numbers that are not fuels (101 and 102 average to 101.5). A DEM is a
 * CONTINUOUS surface, where nearest produces a blocky elevation field and bilinear is
 * correct. Same run, same window, two different right answers, and getting them the
 * wrong way round is silent in both directions.
 */

const LOCAL_GRID = '/ds/generated/grid/100m/default/fuel_11_0.tif';
const COMPANION_DEM = '/ds/generated/grid/100m/default/dem_11_0.tif';

const WCS_ENV = {
  NOMAD_FUEL_SOURCE: 'wcs',
  NOMAD_FUEL_WCS_URL: 'https://ca.nfis.org/mapserver/cgi-bin/fbp_eng.cgi',
  NOMAD_FUEL_WCS_COVERAGE: 'fbp100m2026wcs',
  NOMAD_FUEL_WCS_CACHE_DIR: '/data/fuel-cache',
};

const REQUEST = {
  latitude: 60.82,
  longitude: -115.7,
  modelYear: 2026,
  utmZone: 11,
  resolutionM: 100,
  windowM: 20000,
  workingDir: '/sims/model-1',
};

/** The geotransform the warped fuel grid reports. Asymmetric on purpose. */
const FUEL_GRID = {
  originX: 412300,
  originY: 6755900,
  width: 203,
  height: 211,
  pixelW: 100,
  pixelH: 100,
};

function deps(over: Partial<FuelGridForRunDeps> = {}): FuelGridForRunDeps {
  return {
    findLocalGrid: vi.fn().mockResolvedValue(LOCAL_GRID),
    findCompanionDem: vi.fn().mockResolvedValue(COMPANION_DEM),
    readRasterEpsg: vi.fn().mockResolvedValue(26911),
    readRasterGrid: vi.fn().mockResolvedValue(FUEL_GRID),
    fetchCoverage: vi.fn().mockResolvedValue('/data/fuel-cache/cov.tif'),
    readGridValues: vi.fn().mockResolvedValue([1, 2, 101, 0]),
    toEpsg3978: vi.fn().mockResolvedValue({ x: 570705, y: 6743438 }),
    warp: vi.fn().mockResolvedValue(undefined),
    nilValue: vi.fn().mockReturnValue(0),
    ensureDir: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

/** Every recorded gdalwarp argv, in call order. */
function warpCalls(warp: FuelGridForRunDeps['warp']): string[][] {
  return (warp as unknown as Mock).mock.calls.map((c) => c[0] as string[]);
}
function flagValues(argv: string[], flag: string, count: number): string[] {
  const at = argv.indexOf(flag);
  if (at === -1) throw new Error(`no ${flag} in argv: ${argv.join(' ')}`);
  return argv.slice(at + 1, at + 1 + count);
}

describe('#563 Step 2 — a co-registered DEM in the per-run raster root', () => {
  it('writes dem_{zone}_0.tif into the SAME directory as the fuel grid', async () => {
    // FireSTARR selects its own grids inside --raster-root. A DEM written anywhere else
    // is a file that exists and an engine that still dies on a bare root.
    const d = deps();
    const result = await resolveFuelGridForRun(REQUEST, d, WCS_ENV);

    const demWrite = warpCalls(d.warp).find((a) => a.some((t) => t.includes('dem_11_0.tif')));
    expect(demWrite, 'no gdalwarp call wrote a dem_11_0.tif').toBeDefined();
    const demPath = demWrite![demWrite!.length - 1];
    expect(basename(demPath)).toBe('dem_11_0.tif');
    expect(dirname(demPath)).toBe(dirname(result.gridPath));
  });

  it('pins the fuel grid\'s EXACT bounds and pixel dimensions, not its resolution', async () => {
    // -te AND -ts, never -te with -tr. Bounds plus a cell size can land a pixel count
    // one off through floating point, and one cell of difference is
    // `FATAL: Grids are not aligned` — the whole failure this step exists to remove.
    const d = deps();
    await resolveFuelGridForRun(REQUEST, d, WCS_ENV);

    const demWrite = warpCalls(d.warp).find((a) => a.some((t) => t.includes('dem_11_0.tif')))!;
    expect(flagValues(demWrite, '-te', 4)).toEqual([
      '412300', // minX = originX
      '6734800', // minY = originY - height * pixelH
      '432600', // maxX = originX + width * pixelW
      '6755900', // maxY = originY
    ]);
    expect(flagValues(demWrite, '-ts', 2)).toEqual(['203', '211']);
    expect(demWrite).not.toContain('-tr');
  });

  it('clips the DEM into the same CRS the fuel grid was warped to', async () => {
    const d = deps();
    await resolveFuelGridForRun(REQUEST, d, WCS_ENV);

    const [fuelWrite, demWrite] = warpCalls(d.warp);
    expect(flagValues(fuelWrite, '-t_srs', 1)).toEqual(['EPSG:26911']);
    expect(flagValues(demWrite, '-t_srs', 1)).toEqual(['EPSG:26911']);
  });

  it('resamples the DEM BILINEAR and the fuel NEAREST, in the same run', async () => {
    // The paired assertion. Each kernel is wrong for the other raster, and both
    // mistakes are silent: a nearest DEM is blocky but plausible, and a bilinear fuel
    // grid is full of values that are not fuels at all.
    const d = deps();
    await resolveFuelGridForRun(REQUEST, d, WCS_ENV);

    const [fuelWrite, demWrite] = warpCalls(d.warp);
    expect(flagValues(fuelWrite, '-r', 1)).toEqual(['near']);
    expect(flagValues(demWrite, '-r', 1)).toEqual(['bilinear']);
  });

  it('reads the geotransform off the WARPED fuel grid, never the fetched coverage', async () => {
    // The coverage is EPSG:3978 and a different extent. Snapping the DEM to IT would
    // produce two rasters that disagree while every step reported success.
    const readRasterGrid = vi.fn().mockResolvedValue(FUEL_GRID);
    const d = deps({ readRasterGrid });
    const result = await resolveFuelGridForRun(REQUEST, d, WCS_ENV);

    expect(readRasterGrid).toHaveBeenCalledWith(result.gridPath);
    expect(readRasterGrid).not.toHaveBeenCalledWith('/data/fuel-cache/cov.tif');
  });

  it('clips the DEM from the companion DEM, which is the one the CRS came from', async () => {
    const d = deps();
    await resolveFuelGridForRun(REQUEST, d, WCS_ENV);

    const demWrite = warpCalls(d.warp).find((a) => a.some((t) => t.includes('dem_11_0.tif')))!;
    expect(demWrite).toContain(COMPANION_DEM);
  });

  it('does none of this on the local path, which keeps using the installed root', async () => {
    const d = deps();
    const result = await resolveFuelGridForRun(REQUEST, d, {});

    expect(result.source).toBe('local');
    expect(d.warp).not.toHaveBeenCalled();
    expect(d.readRasterGrid).not.toHaveBeenCalled();
  });
});

function gdalPresent(): boolean {
  try {
    execFileSync('gdalwarp', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const HAVE_GDAL = gdalPresent();

describe.skipIf(!HAVE_GDAL)('#563 Step 2 — the clip really does co-register, with GDAL', () => {
  /** origin, size and EPSG as gdalinfo reports them. */
  function describeRaster(path: string): {
    originX: number;
    originY: number;
    width: number;
    height: number;
    epsg: string;
  } {
    const info = JSON.parse(
      execFileSync('gdalinfo', ['-json', path], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    );
    const gt = info.geoTransform as number[];
    return {
      originX: gt[0],
      originY: gt[3],
      width: info.size[0],
      height: info.size[1],
      epsg: String(info.stac?.['proj:epsg'] ?? info.coordinateSystem?.wkt?.match(/ID\["EPSG",(\d+)\]/)?.[1]),
    };
  }

  /**
   * A source DEM far wider than the window, deliberately offset from it.
   *
   * COMPUTED, NOT HARDCODED: its origin is set 7 km west and 3 km north of the fuel
   * window and its cell size is 30 m rather than 100 m, so a clip that merely copied
   * the source's geotransform would land nowhere near the target and the assertions
   * below would catch it. A fixture already sharing the target grid would make them
   * pass without the clip doing anything.
   */
  function makeSourceDem(dir: string): string {
    const path = join(dir, 'source_dem.tif');
    const ulx = FUEL_GRID.originX - 7000;
    const uly = FUEL_GRID.originY + 3000;
    const lrx = FUEL_GRID.originX + FUEL_GRID.width * FUEL_GRID.pixelW + 7000;
    const lry = FUEL_GRID.originY - FUEL_GRID.height * FUEL_GRID.pixelH - 3000;
    const cols = Math.round((lrx - ulx) / 30);
    const rows = Math.round((uly - lry) / 30);
    execFileSync(
      'gdal_create',
      [
        '-of', 'GTiff',
        '-outsize', String(cols), String(rows),
        '-a_srs', 'EPSG:26911',
        '-a_ullr', String(ulx), String(uly), String(lrx), String(lry),
        '-ot', 'Float32',
        '-burn', '350',
        path,
      ],
      { stdio: 'ignore' }
    );
    return path;
  }

  it('produces a DEM whose origin, size and CRS match the fuel window exactly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'demclip-'));
    try {
      const source = makeSourceDem(dir);
      const out = join(dir, 'dem_11_0.tif');
      execFileSync(
        'gdalwarp',
        buildDemClipArgs({
          sourcePath: source,
          targetPath: out,
          targetEpsg: 26911,
          originX: FUEL_GRID.originX,
          originY: FUEL_GRID.originY,
          width: FUEL_GRID.width,
          height: FUEL_GRID.height,
          pixelW: FUEL_GRID.pixelW,
          pixelH: FUEL_GRID.pixelH,
        }),
        { stdio: 'ignore' }
      );
      expect(existsSync(out)).toBe(true);

      const got = describeRaster(out);
      expect(got.originX).toBeCloseTo(FUEL_GRID.originX, 6);
      expect(got.originY).toBeCloseTo(FUEL_GRID.originY, 6);
      expect(got.width).toBe(FUEL_GRID.width);
      expect(got.height).toBe(FUEL_GRID.height);
      expect(got.epsg).toBe('26911');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('CONTROL: a window shifted half a cell produces a DEM the equality REJECTS', () => {
    // Without this, "the origin matched" could mean the assertion is incapable of
    // failing. Half a cell is the smallest offset that still means `Grids are not
    // aligned`, so it is the right size of lie to tell.
    const dir = mkdtempSync(join(tmpdir(), 'demclip-bad-'));
    try {
      const source = makeSourceDem(dir);
      const out = join(dir, 'dem_shifted.tif');
      execFileSync(
        'gdalwarp',
        buildDemClipArgs({
          sourcePath: source,
          targetPath: out,
          targetEpsg: 26911,
          originX: FUEL_GRID.originX + 50,
          originY: FUEL_GRID.originY,
          width: FUEL_GRID.width,
          height: FUEL_GRID.height,
          pixelW: FUEL_GRID.pixelW,
          pixelH: FUEL_GRID.pixelH,
        }),
        { stdio: 'ignore' }
      );

      const got = describeRaster(out);
      expect(got.originX).not.toBeCloseTo(FUEL_GRID.originX, 6);
      // and the control must be wrong ONLY in the way intended
      expect(got.width).toBe(FUEL_GRID.width);
      expect(got.height).toBe(FUEL_GRID.height);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
