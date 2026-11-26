import { describe, it, expect, vi, type Mock } from 'vitest';
import { resolveFuelGridForRun, type FuelGridForRunDeps } from '../fuelGridForRun.js';

/**
 * #563 Step 1: THE WARP MUST TARGET THE CRS OF THE RASTER THE ENGINE PAIRS AGAINST,
 * not a CRS our own code composes from a zone number.
 *
 * WHY THIS SUITE EXISTS AND WHY IT IS SHAPED THIS WAY. #282's D9 check asserted the
 * produced grid's CRS equalled `utmEpsgForZone(zone)` — and it PASSED, while FireSTARR
 * answered `Grids are not aligned`. The check agreed with our constant; the constant
 * disagreed with the installed dataset, which is NAD83 / UTM (26900 + zone) for both
 * fuel and DEM. A guard pointed at our own constant could never catch that.
 *
 * So every assertion here is pointed at the COMPANION DEM's declared CRS — the raster
 * alignment is actually with — and never at a constant of ours.
 *
 * THE TWO CASES BELOW MUST DISAGREE BEFORE THE FIX. The NAD83 case must fail (the code
 * composes 32611 from zone 11) and the WGS84 control must pass (32611 is what it
 * composes). One failing and one passing run of the same assertion shape is the only
 * thing that proves the test discriminates rather than being satisfiable by accident.
 * A pair that both go red proves only that the harness is unfinished.
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

function deps(over: Partial<FuelGridForRunDeps> = {}): FuelGridForRunDeps {
  return {
    findLocalGrid: vi.fn().mockResolvedValue(LOCAL_GRID),
    findCompanionDem: vi.fn().mockResolvedValue(COMPANION_DEM),
    // The dataset is NAD83, so this is the realistic default and the one the old code
    // could not produce. Cases that need the other datum override it.
    readRasterEpsg: vi.fn().mockResolvedValue(26911),
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

/** The `-t_srs` value actually handed to gdalwarp, read off the recorded argv. */
function targetSrsOf(warp: FuelGridForRunDeps['warp']): string {
  const calls = (warp as unknown as Mock).mock.calls;
  if (calls.length === 0) {
    throw new Error('gdalwarp was never called, so there is no target CRS to read');
  }
  const argv = calls[0][0] as string[];
  const at = argv.indexOf('-t_srs');
  if (at === -1) {
    throw new Error(`no -t_srs in the warp argv: ${argv.join(' ')}`);
  }
  return argv[at + 1];
}

describe('#563 Step 1 — the warp targets the companion DEM CRS', () => {
  it('targets NAD83 / UTM 11N when the companion DEM declares EPSG:26911', async () => {
    // THE DEFECT. The installed dataset is NAD83 for both fuel and DEM, verified on
    // zones 10 and 11. Composing 32600 + zone produces 32611 and the engine refuses.
    const d = deps({ readRasterEpsg: vi.fn().mockResolvedValue(26911) });
    await resolveFuelGridForRun(REQUEST, d, WCS_ENV);

    expect(targetSrsOf(d.warp)).toBe('EPSG:26911');
  });

  it('CONTROL: targets WGS84 / UTM 11N when the companion DEM declares EPSG:32611', async () => {
    // The same assertion shape against the value the OLD code happens to compose. This
    // must pass both before and after the fix. If it ever fails, the test above is red
    // for a harness reason and says nothing about the datum.
    const d = deps({ readRasterEpsg: vi.fn().mockResolvedValue(32611) });
    await resolveFuelGridForRun(REQUEST, d, WCS_ENV);

    expect(targetSrsOf(d.warp)).toBe('EPSG:32611');
  });

  it('reads the CRS off the companion DEM, not off a fuel tile', async () => {
    // Asserting the PATH matters: reading the CRS off the WCS fuel grid instead would
    // compare the coverage against itself and agree in every case, including the broken
    // one. The DEM is the raster FireSTARR pairs the fuel with, so it is the only
    // reading that can disagree with us.
    const readRasterEpsg = vi.fn().mockResolvedValue(26911);
    const d = deps({ readRasterEpsg });
    await resolveFuelGridForRun(REQUEST, d, WCS_ENV);

    expect(readRasterEpsg).toHaveBeenCalledWith(COMPANION_DEM);
    expect(readRasterEpsg).not.toHaveBeenCalledWith(LOCAL_GRID);
  });

  it('does NOT obtain fuel from the local selector in the WCS branch', async () => {
    // The elevation dependency must not become a fuel fallback by the back door. There
    // is no fallback between sources, in either direction: a WCS run that quietly read
    // local fuel would record the WCS as its producer.
    const d = deps();
    await resolveFuelGridForRun(REQUEST, d, WCS_ENV);

    expect(d.findLocalGrid).not.toHaveBeenCalled();
  });

  it('refuses when the companion DEM has no readable CRS, rather than defaulting', async () => {
    // Fail fast. A default here would put a fire on the wrong ground while every
    // artefact in the run said the WCS had been used.
    const d = deps({
      readRasterEpsg: vi.fn().mockRejectedValue(new Error('no spatial reference')),
    });

    await expect(resolveFuelGridForRun(REQUEST, d, WCS_ENV)).rejects.toThrow(/no spatial reference/i);
  });

  it('refuses when no companion DEM covers the ignition', async () => {
    // The consequence the issue says to state rather than inherit: THE WCS FUEL SOURCE
    // DOES NOT STAND ALONE. It still needs the installed dataset for elevation, so a
    // WCS run outside local coverage has no companion DEM and cannot be aligned.
    const d = deps({ findCompanionDem: vi.fn().mockResolvedValue(undefined) });

    await expect(resolveFuelGridForRun(REQUEST, d, WCS_ENV)).rejects.toThrow(
      /companion DEM|does not stand alone/i
    );
  });

  it('refuses BEFORE downloading when the DEM is missing', async () => {
    // Ordered against a specific way of being wrong: discovering an unalignable run
    // after fetching a 20 km window charges the operator for the lesson.
    const d = deps({ findCompanionDem: vi.fn().mockResolvedValue(undefined) });

    await expect(resolveFuelGridForRun(REQUEST, d, WCS_ENV)).rejects.toThrow();
    expect(d.fetchCoverage).not.toHaveBeenCalled();
    expect(d.warp).not.toHaveBeenCalled();
  });
});
