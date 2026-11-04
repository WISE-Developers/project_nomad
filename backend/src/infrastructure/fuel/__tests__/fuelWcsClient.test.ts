import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGetCoverageUrl, fetchFuelCoverage } from '../fuelWcsClient';

/**
 * #282 task 1 — the WCS client.
 *
 * Request shape was proven against the live service before any of this was
 * written: single-band Int16, EPSG:3978, `subset=x()/y()` as DescribeCoverage
 * advertises (`axisLabels="x y"`), 100 m native.
 */
const BASE = 'https://ca.nfis.org/mapserver/cgi-bin/fbp_eng.cgi';
const COVERAGE = 'fbp100m2026wcs';
// A real 20 km window around the point BadgerOnABike gave on #282.
const BBOX = { minX: -664721, minY: 1428398, maxX: -644721, maxY: 1448398 };
const TIFF = Uint8Array.from([0x49, 0x49, 0x2a, 0x00, 1, 2, 3, 4]);

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fuelwcs-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe('buildGetCoverageUrl', () => {
  it('asks for the coverage by bbox, in the axis order the service advertises', () => {
    const url = new URL(buildGetCoverageUrl({ baseUrl: BASE, coverageId: COVERAGE, bbox: BBOX }));
    expect(url.searchParams.get('SERVICE')).toBe('WCS');
    expect(url.searchParams.get('REQUEST')).toBe('GetCoverage');
    expect(url.searchParams.get('version')).toBe('2.0.1');
    expect(url.searchParams.get('CoverageId')).toBe(COVERAGE);
    expect(url.searchParams.get('outputformat')).toBe('geotiff');
    // Two separate `subset` parameters, x then y, matching axisLabels="x y".
    expect(url.searchParams.getAll('subset')).toEqual([
      'x(-664721,-644721)',
      'y(1428398,1448398)',
    ]);
  });

  it('NEVER asks the server to reproject', () => {
    // Deliberate absence, pinned. Server-side `outputCrs` works but returns the
    // same pixel COUNT stretched over the reprojected extent: a 10 km request
    // came back at 132 m from a 100 m source (measured 2026-11-04). Reprojection
    // belongs locally, nearest-neighbour, at an explicit resolution - condition
    // 4 of the #282 plan. If this assertion is ever relaxed, the grid silently
    // coarsens.
    const url = buildGetCoverageUrl({ baseUrl: BASE, coverageId: COVERAGE, bbox: BBOX });
    expect(url).not.toMatch(/outputCrs/i);
    expect(url).not.toMatch(/32611/);
  });

  it('refuses a bbox with no area instead of asking the service for nothing', () => {
    const degenerate = { minX: 10, minY: 20, maxX: 10, maxY: 40 };
    expect(() =>
      buildGetCoverageUrl({ baseUrl: BASE, coverageId: COVERAGE, bbox: degenerate }),
    ).toThrow(/area/i);
  });

  it('refuses an inverted bbox rather than silently swapping it', () => {
    // Swapping would produce a plausible raster for a window the caller did not
    // ask for, which is worse than an error.
    const inverted = { minX: 0, minY: 0, maxX: -100, maxY: 100 };
    expect(() =>
      buildGetCoverageUrl({ baseUrl: BASE, coverageId: COVERAGE, bbox: inverted }),
    ).toThrow(/inverted|minX/i);
  });
});

describe('fetchFuelCoverage', () => {
  it('writes the GeoTIFF and returns its path', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(TIFF, { status: 200, headers: { 'Content-Type': 'image/tiff' } })),
    );
    const path = await fetchFuelCoverage(
      { baseUrl: BASE, coverageId: COVERAGE, bbox: BBOX, cacheDir: dir },
    );
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path).subarray(0, 4)).toEqual(Buffer.from([0x49, 0x49, 0x2a, 0x00]));
  });

  it('surfaces the out-of-extent 400 LOUDLY and writes nothing', async () => {
    // The service refuses windows outside the coverage with HTTP 400 rather than
    // padding - which is the behaviour we want, provided we do not swallow it.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<ServiceExceptionReport/>', { status: 400, statusText: 'Bad Request' })),
    );
    // Matches text ONLY the status check produces. `/400/` alone was not
    // enough: a 400 body is not TIFF either, so the magic-bytes guard threw
    // instead and its message also contains "HTTP 400". Proven by mutation -
    // deleting the status check left all eight tests green.
    await expect(
      fetchFuelCoverage({ baseUrl: BASE, coverageId: COVERAGE, bbox: BBOX, cacheDir: dir }),
    ).rejects.toThrow(/GetCoverage failed: 400 Bad Request/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('refuses an XML exception served with HTTP 200, and writes nothing', async () => {
    // MapServer can answer 200 with an OGC exception body. Trusting the status
    // alone would write a file named .tif containing XML, and the failure would
    // surface later as an unreadable raster with no trace of this request.
    const xml = '<?xml version="1.0"?><ows:ExceptionReport>NoApplicableCode</ows:ExceptionReport>';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(xml, { status: 200, headers: { 'Content-Type': 'text/xml' } })),
    );
    await expect(
      fetchFuelCoverage({ baseUrl: BASE, coverageId: COVERAGE, bbox: BBOX, cacheDir: dir }),
    ).rejects.toThrow(/are not a GeoTIFF/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('fails fast when no cache directory is configured', async () => {
    // A silent default here would write into whatever the process cwd happens to
    // be, outside the paths the dev container mounts, and FireSTARR would later
    // report "file not found" rather than a missing mount.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(TIFF, { status: 200 })));
    await expect(
      fetchFuelCoverage({ baseUrl: BASE, coverageId: COVERAGE, bbox: BBOX, cacheDir: '' }),
    ).rejects.toThrow(/cache/i);
  });
});
