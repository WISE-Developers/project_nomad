import { describe, it, expect, vi } from 'vitest';
import { resolveFuelGridForRun, type FuelGridForRunDeps } from '../fuelGridForRun.js';

/**
 * #282 Step 2: the seam where the five fuel modules acquire a production caller.
 *
 * WHAT THIS SUITE IS FOR, and what it deliberately does not claim. It proves the
 * COMPOSITION: which module is called, in what order, with what values, and that a
 * misconfiguration refuses instead of falling back. It does not prove the grid is
 * spatially correct — that is Step 3b (plan D9), needs a real coverage and real GDAL,
 * and cannot be reached with injected doubles. A suite like this passing is exactly the
 * state plan D5 was written about: #533 shipped with every test asserting configuration
 * and none asserting reachability.
 *
 * Every dependency is injected so the unit tests touch no network and no GDAL. The
 * injection points exist for that reason and for Step 3's harness, not to allow
 * production to substitute a different fuel path.
 */

const LOCAL_GRID = '/ds/generated/grid/100m/default/fuel_11_0.tif';
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

function deps(over: Partial<FuelGridForRunDeps> = {}): FuelGridForRunDeps {
  return {
    findLocalGrid: vi.fn().mockResolvedValue(LOCAL_GRID),
    // #563: the WCS branch now requires a companion DEM and reads the reprojection
    // target off it. Stubbed at 32611 — exactly what `32600 + zone` composed for zone 11
    // — so every existing assertion in this file keeps its original expected value and
    // this change is signature-only. The DEM/datum behaviour itself is proven in
    // fuelGridForRun.demCrs.test.ts, where the stub returns NAD83 and the pair of cases
    // is required to disagree.
    findCompanionDem: vi.fn().mockResolvedValue('/ds/generated/grid/100m/default/dem_11_0.tif'),
    readRasterEpsg: vi.fn().mockResolvedValue(32611),
    // #563 step 2: the DEM is cut to the warped fuel grid's own measured window.
    readRasterGrid: vi.fn().mockResolvedValue({
      originX: 412300,
      originY: 6755900,
      width: 203,
      height: 211,
      pixelW: 100,
      pixelH: 100,
    }),
    fetchCoverage: vi.fn().mockResolvedValue('/data/fuel-cache/cov.tif'),
    readGridValues: vi.fn().mockResolvedValue([1, 2, 101, 0]),
    toEpsg3978: vi.fn().mockResolvedValue({ x: 570705, y: 6743438 }),
    warp: vi.fn().mockResolvedValue(undefined),
    nilValue: vi.fn().mockReturnValue(0),
    ensureDir: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe('resolveFuelGridForRun — local, the default (#282, D1)', () => {
  it('uses the local selector and records the local producer when the flag is unset', async () => {
    const d = deps();
    const result = await resolveFuelGridForRun(REQUEST, d, {});

    expect(result.source).toBe('local');
    expect(result.gridPath).toBe(LOCAL_GRID);
    expect(result.producer).toBe('local installed fuel dataset');
    expect(d.findLocalGrid).toHaveBeenCalledWith(60.82, -115.7, 2026);
  });

  it('touches NOTHING of the WCS path when the flag is unset', async () => {
    // Condition 4 in miniature. An existing deployment sets none of these keys, so an
    // unset environment must not fetch, decode, warp, or even ask for the nil value —
    // the last one matters because that getter THROWS when unset, which would turn
    // every local run into a crash the moment this seam landed.
    const d = deps();
    await resolveFuelGridForRun(REQUEST, d, {});

    expect(d.fetchCoverage).not.toHaveBeenCalled();
    expect(d.warp).not.toHaveBeenCalled();
    expect(d.readGridValues).not.toHaveBeenCalled();
    expect(d.nilValue).not.toHaveBeenCalled();
  });

  it('explicitly resolving local behaves the same as unset', async () => {
    const d = deps();
    const result = await resolveFuelGridForRun(REQUEST, d, { NOMAD_FUEL_SOURCE: 'local' });
    expect(result.source).toBe('local');
    expect(d.fetchCoverage).not.toHaveBeenCalled();
  });

  it('refuses when the local selector finds no grid, rather than returning undefined', async () => {
    const d = deps({ findLocalGrid: vi.fn().mockResolvedValue(undefined) });
    await expect(resolveFuelGridForRun(REQUEST, d, {})).rejects.toThrow(/no local fuel grid/i);
  });
});

describe('resolveFuelGridForRun — wcs, opt-in (#282, D1/D2/D4)', () => {
  it('fetches, guards, reprojects, and records the coverage as producer', async () => {
    const d = deps();
    const result = await resolveFuelGridForRun(REQUEST, d, WCS_ENV);

    expect(result.source).toBe('wcs');
    expect(result.producer).toBe('CFS FBP WCS coverage fbp100m2026wcs');
    // The grid handed on is the REPROJECTED one, not the fetched coverage. Handing back
    // the EPSG:3978 download would be a path that ran and a fire in the wrong place.
    expect(result.gridPath).not.toBe('/data/fuel-cache/cov.tif');
    expect(result.gridPath).toMatch(/\.tif$/);
    expect(d.findLocalGrid).not.toHaveBeenCalled();
    expect(d.fetchCoverage).toHaveBeenCalledTimes(1);
    // #563 step 2: the WCS branch now runs gdalwarp TWICE — the fuel reprojection and
    // the DEM clip snapped onto it. This replaced a bare `toHaveBeenCalledTimes(1)`.
    //
    // NAMED RATHER THAN COUNTED, because the count alone never said WHICH warp it meant:
    // it would have passed just as happily on two fuel warps and no DEM, which is
    // precisely the state FireSTARR answers with exit 139 and no output at all. The
    // count is kept alongside so a THIRD warp appearing later fails here instead of
    // slipping in unexamined.
    const warpTargets = (d.warp as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => (c[0] as string[])[(c[0] as string[]).length - 1]
    );
    expect(warpTargets.filter((t) => t.endsWith('fuel_11_0.tif'))).toHaveLength(1);
    expect(warpTargets.filter((t) => t.endsWith('dem_11_0.tif'))).toHaveLength(1);
    expect(d.warp).toHaveBeenCalledTimes(2);
  });

  it('requests a window centred on the ignition in projected metres', async () => {
    const d = deps();
    await resolveFuelGridForRun(REQUEST, d, WCS_ENV);

    const call = (d.fetchCoverage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.coverageId).toBe('fbp100m2026wcs');
    expect(call.cacheDir).toBe('/data/fuel-cache');
    // 20 km window, so 10 km either side of the projected ignition.
    expect(call.bbox).toEqual({
      minX: 570705 - 10000,
      maxX: 570705 + 10000,
      minY: 6743438 - 10000,
      maxY: 6743438 + 10000,
    });
  });

  it('passes the OPERATOR-DECLARED nil value to the guard, never a default (D2)', async () => {
    const nilValue = vi.fn().mockReturnValue(-9999);
    const assertCanonical = vi.fn();
    const d = deps({ nilValue, assertCanonical });
    await resolveFuelGridForRun(REQUEST, d, WCS_ENV);

    expect(nilValue).toHaveBeenCalledTimes(1);
    expect(assertCanonical.mock.calls[0][2]).toBe(-9999);
  });

  it('refuses when the nil value is not configured, and fetches nothing first', async () => {
    // The order is the assertion. Asking for the nil value AFTER downloading means an
    // operator who has not declared one pays for an 11 GB-scale transfer to be told so.
    const d = deps({
      nilValue: vi.fn(() => {
        throw new Error('Required environment variable "NOMAD_FUEL_NODATA_VALUE" is not set.');
      }),
    });
    await expect(resolveFuelGridForRun(REQUEST, d, WCS_ENV)).rejects.toThrow(
      /NOMAD_FUEL_NODATA_VALUE/
    );
    expect(d.fetchCoverage).not.toHaveBeenCalled();
  });

  it('refuses a misconfigured wcs source with NO fallback to local', async () => {
    const d = deps();
    await expect(
      resolveFuelGridForRun(REQUEST, d, { NOMAD_FUEL_SOURCE: 'wcs' })
    ).rejects.toThrow(/NOMAD_FUEL_WCS_URL/);
    // The whole point: a fallback here would run the fire on local tiles while the
    // operator believed it used the WCS, and the producer field would say so too.
    expect(d.findLocalGrid).not.toHaveBeenCalled();
  });

  it('refuses an unrecognised source rather than defaulting', async () => {
    const d = deps();
    await expect(
      resolveFuelGridForRun(REQUEST, d, { NOMAD_FUEL_SOURCE: 'nfis' })
    ).rejects.toThrow(/expected "local" or "wcs"/);
  });

  it('refuses when the fetched coverage carries values the LUT does not define', async () => {
    const d = deps({
      assertCanonical: vi.fn(() => {
        throw new Error('fuel grid carries 2 value(s) absent from the canonical LUT: 777, 888.');
      }),
    });
    await expect(resolveFuelGridForRun(REQUEST, d, WCS_ENV)).rejects.toThrow(/777, 888/);
    // Guard before warp: reprojecting an undecodable grid produces a confident raster
    // of values that are not fuels.
    expect(d.warp).not.toHaveBeenCalled();
  });

  it("reprojects to the companion DEM's CRS at the stated resolution, nearest-neighbour", async () => {
    const d = deps();
    await resolveFuelGridForRun(REQUEST, d, WCS_ENV);

    const args: string[] = (d.warp as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args).toContain('-t_srs');
    expect(args[args.indexOf('-t_srs') + 1]).toBe('EPSG:32611');
    expect(args[args.indexOf('-tr') + 1]).toBe('100');
    expect(args[args.indexOf('-r') + 1]).toBe('near');
  });

  it('returns a RASTER ROOT for the engine, with the grid inside it under the name FireSTARR looks for', async () => {
    // The engine takes --raster-root, a directory, and picks its own grid inside it. A
    // grid written anywhere else is a file nothing reads, which is what the path looked
    // like before this field existed: every guard green, the fire on local fuel.
    const d = deps();
    const result = await resolveFuelGridForRun(REQUEST, d, WCS_ENV);

    expect(result.fuelRasterRoot).toBe('/sims/model-1/fuelgrid');
    expect(result.gridPath).toBe('/sims/model-1/fuelgrid/default/fuel_11_0.tif');
    // `default` rather than the model year, so the engine finds it whatever year is
    // asked for — the window was cut for this run's ignition.
    expect(d.ensureDir).toHaveBeenCalledWith('/sims/model-1/fuelgrid/default');
  });

  it('CONTROL: a local run carries NO raster root, so the installed one keeps being used', async () => {
    const result = await resolveFuelGridForRun(REQUEST, deps(), {});
    expect(result.fuelRasterRoot).toBeUndefined();
  });

  it('tells the warp the declared nil as the fill, and exempts it from the domain check', async () => {
    const assertDomain = vi.fn();
    const d = deps({ nilValue: vi.fn().mockReturnValue(0), assertDomain });
    await resolveFuelGridForRun(REQUEST, d, WCS_ENV);

    const args: string[] = (d.warp as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args[args.indexOf('-dstnodata') + 1]).toBe('0');
    // Third argument is the nil. Without it the check fails a correct reprojection,
    // because the rotated footprint's corners are filled with exactly this value.
    expect(assertDomain.mock.calls[0][2]).toBe(0);
  });

  it('checks the reprojection invented no class, after the warp', async () => {
    const assertDomain = vi.fn();
    const d = deps({ assertDomain });
    await resolveFuelGridForRun(REQUEST, d, WCS_ENV);
    expect(assertDomain).toHaveBeenCalledTimes(1);
  });

  it('refuses when the reprojection invented a class', async () => {
    const d = deps({
      assertDomain: vi.fn(() => {
        throw new Error('reprojection invented 1 class(es) absent from the source: 376.');
      }),
    });
    await expect(resolveFuelGridForRun(REQUEST, d, WCS_ENV)).rejects.toThrow(/invented 1 class/);
  });
});
