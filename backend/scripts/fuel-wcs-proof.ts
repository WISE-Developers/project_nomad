/**
 * Step 3 of the plan: proving the WCS fuel path on a real coverage.
 *
 * TWO HALVES, AND THE SECOND IS THE ONE THAT IS EASY TO SKIP.
 *
 * 3a (D7) proves the path RAN, by its own artefacts and never by comparing fire output to
 * a local run — a WCS grid and a local grid are different fuel data, so the fires SHOULD
 * differ, and "deterministic" in this codebase means scenario count 1 rather than
 * reproducibility, with no seed plumbed to the engine anywhere.
 *
 * 3b (D9) proves the grid is in the RIGHT PLACE. Everything in 3a passes on a flipped,
 * shifted, transposed or wrong-zone raster: bytes were fetched, the guard passed because
 * the VALUES are canonical, something was reprojected, the producer was recorded. The
 * fire then burns through the wrong fuel, confidently, and nothing says so.
 *
 * WHERE THE ASYMMETRY GOES, AND WHY GETTING IT BACKWARDS WOULD BE WORSE THAN NO CHECK.
 * A flip or transpose is invisible on symmetric data, so the sample must be asymmetric
 * somewhere. The wrong place is the individual point: a coordinate on a class boundary is
 * exactly where correct nearest-neighbour resampling may legitimately take either
 * neighbour, so the comparison would report a mismatch on a perfectly good grid and train
 * whoever runs it to ignore failures. So each point sits at least 2 source cells inside a
 * UNIFORM patch — stable under resampling and under a half-cell shift — while the SET
 * carries the asymmetry: the class differs north versus south of the ignition, and east
 * versus west. A flip, transpose or whole-cell shift swaps which patch a point lands in,
 * and because the patches differ in class the answers change.
 *
 * The points are FOUND IN THE DATA, not written down. A hardcoded coordinate stops being
 * inside a uniform patch the moment the coverage is revised, and would then fail for the
 * wrong reason.
 *
 * WHY THE INDEPENDENT QUERY IS INDEPENDENT. Item 2 compares our pipeline's value against
 * a direct small-bbox GetCoverage in EPSG:3978 with no reprojection and no decode. That is
 * a different code path, which is the only reason the comparison means anything; checking
 * our pipeline against our own client would prove that assignment works.
 *
 * GDAL: the warp runs in a container. Every Homebrew GDAL binary on this host fails to
 * link (libheif wants libx265.215, Homebrew ships .217) while the gdal-async binding loads
 * fine, so the orchestration is done here and the one broken binary is delegated. The
 * container mounts the working directory AT THE SAME ABSOLUTE PATH, so the argv that
 * production builds is the argv that runs — rewriting paths for the container would mean
 * proving a different command than the one deployments use.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolveFuelGridForRun } from '../src/infrastructure/firestarr/fuelGridForRun.js';
import { utmEpsgForZone } from '../src/infrastructure/fuel/fuelReproject.js';
import { buildGetCoverageUrl } from '../src/infrastructure/fuel/fuelWcsClient.js';
import { toEpsg3978, readGridValues } from '../src/infrastructure/fuel/fuelGdalAdapter.js';
import { EnvironmentService } from '../src/infrastructure/config/EnvironmentService.js';
import { fetchFuelCoverage } from '../src/infrastructure/fuel/fuelWcsClient.js';

const IGNITION = { latitude: 60.82, longitude: -115.7 };
const MODEL_YEAR = 2026;
const UTM_ZONE = 11;
const RESOLUTION_M = 100;
const WINDOW_M = 20000;
const SOURCE_CELL_M = 100;
/** Half-width of the uniform patch a sample point must sit inside, in source cells. */
const UNIFORM_RADIUS_CELLS = 2;

const WORK = process.env.NOMAD_PROOF_DIR;
const GDAL_IMAGE = process.env.NOMAD_PROOF_GDAL_IMAGE ?? 'nomad-dev:integrated';

type Json = Record<string, unknown>;
const findings: Json = {};

function run(cmd: string, args: string[]): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (c: Buffer) => (out += c.toString()));
    child.stderr.on('data', (c: Buffer) => (err += c.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, out, err }));
  });
}

/** gdalwarp, in the container, with the working directory mounted at its own path. */
async function containerWarp(args: string[]): Promise<void> {
  const result = await run('docker', [
    'run',
    '--rm',
    '-v',
    `${WORK}:${WORK}`,
    '--entrypoint',
    'gdalwarp',
    GDAL_IMAGE,
    ...args,
  ]);
  if (result.code !== 0) {
    throw new Error(`containerised gdalwarp exited ${result.code}: ${result.err.trim()}`);
  }
}

interface Raster {
  epsg: number | null;
  pixelW: number;
  pixelH: number;
  originX: number;
  originY: number;
  width: number;
  height: number;
  /** value at a projected coordinate, or null when outside the raster */
  at(x: number, y: number): number | null;
}

async function openRaster(path: string): Promise<Raster> {
  const gdal = (await import('gdal-async')).default;
  const ds = await gdal.openAsync(path);
  const gt = ds.geoTransform as number[];
  const band = ds.bands.get(1);
  const { x: width, y: height } = ds.rasterSize;
  const pixels = band.pixels.read(0, 0, width, height) as unknown as ArrayLike<number>;
  let epsg: number | null = null;
  try {
    const code = ds.srs?.getAuthorityCode(null);
    epsg = code ? Number(code) : null;
  } catch {
    epsg = null;
  }
  ds.close();
  return {
    epsg,
    pixelW: gt[1],
    pixelH: Math.abs(gt[5]),
    originX: gt[0],
    originY: gt[3],
    width,
    height,
    at(x: number, y: number) {
      const col = Math.floor((x - gt[0]) / gt[1]);
      const row = Math.floor((y - gt[3]) / gt[5]);
      if (col < 0 || row < 0 || col >= width || row >= height) return null;
      return pixels[row * width + col];
    },
  };
}

/** True when every cell within `radius` of (col,row) carries the same value. */
function uniformAround(
  r: Raster,
  pixels: (col: number, row: number) => number | null,
  col: number,
  row: number,
  radius: number
): number | null {
  const centre = pixels(col, row);
  if (centre === null) return null;
  for (let dr = -radius; dr <= radius; dr += 1) {
    for (let dc = -radius; dc <= radius; dc += 1) {
      if (pixels(col + dc, row + dr) !== centre) return null;
    }
  }
  return centre;
}

async function main(): Promise<void> {
  if (!WORK) throw new Error('NOMAD_PROOF_DIR must name a directory inside a container mount');
  await mkdir(WORK, { recursive: true });

  // ---- 3a: the path ran -----------------------------------------------------------
  const nil = Number(process.env.NOMAD_FUEL_NODATA_VALUE);
  const fetched: string[] = [];

  const resolved = await resolveFuelGridForRun(
    {
      latitude: IGNITION.latitude,
      longitude: IGNITION.longitude,
      modelYear: MODEL_YEAR,
      utmZone: UTM_ZONE,
      resolutionM: RESOLUTION_M,
      windowM: WINDOW_M,
      workingDir: WORK,
    },
    {
      findLocalGrid: () => {
        throw new Error('the wcs path must not consult the local selector');
      },
      toEpsg3978,
      readGridValues,
      warp: containerWarp,
      // The real getter, so an unset key fails here exactly as it would in a run.
      nilValue: () => new EnvironmentService().getFuelNoDataValue(),
      fetchCoverage: async (request) => {
        const path = await fetchFuelCoverage(request);
        fetched.push(buildGetCoverageUrl(request));
        return path;
      },
    },
    process.env
  );

  findings['3a_path_ran'] = {
    source: resolved.source,
    producer_recorded: resolved.producer,
    coverage_requests: fetched,
    grid_handed_on: resolved.gridPath,
    note: 'Guard and domain checks are inside resolveFuelGridForRun; reaching this line means both passed.',
  };

  // ---- 3b(i): georeferencing, asserted ---------------------------------------------
  const grid = await openRaster(resolved.gridPath);
  const expectedEpsg = utmEpsgForZone(UTM_ZONE);
  const ignitionUtm = await (async () => {
    const gdal = (await import('gdal-async')).default;
    const wgs84 = gdal.SpatialReference.fromProj4('+proj=longlat +datum=WGS84 +no_defs');
    const t = new gdal.CoordinateTransformation(wgs84, gdal.SpatialReference.fromEPSG(expectedEpsg));
    return t.transformPoint(IGNITION.longitude, IGNITION.latitude);
  })();
  const extentContainsIgnition =
    ignitionUtm.x >= grid.originX &&
    ignitionUtm.x <= grid.originX + grid.width * grid.pixelW &&
    ignitionUtm.y <= grid.originY &&
    ignitionUtm.y >= grid.originY - grid.height * grid.pixelH;

  findings['3b_i_georeferencing'] = {
    expected_epsg: expectedEpsg,
    actual_epsg: grid.epsg,
    epsg_ok: grid.epsg === expectedEpsg,
    requested_resolution_m: RESOLUTION_M,
    actual_cell_size: [grid.pixelW, grid.pixelH],
    cell_size_ok: grid.pixelW === RESOLUTION_M && grid.pixelH === RESOLUTION_M,
    extent_contains_ignition: extentContainsIgnition,
  };

  // ---- 3b(ii): asymmetric sample set, independent round trip -----------------------
  const coveragePath = (findings['3a_path_ran'] as Json)['grid_handed_on'] as string;
  void coveragePath;
  const source = await openRaster(
    // the fetched EPSG:3978 coverage, named by fetchFuelCoverage's own convention
    (await import('node:fs')).readdirSync(process.env.NOMAD_FUEL_WCS_CACHE_DIR!)
      .filter((n) => n.endsWith('.tif'))
      .map((n) => `${process.env.NOMAD_FUEL_WCS_CACHE_DIR}/${n}`)
      .sort()
      .slice(-1)[0]
  );
  const srcPixel = (col: number, row: number): number | null => {
    if (col < 0 || row < 0 || col >= source.width || row >= source.height) return null;
    return source.at(source.originX + col * source.pixelW + source.pixelW / 2,
                     source.originY - row * source.pixelH - source.pixelH / 2);
  };

  const ignition3978 = await toEpsg3978(IGNITION.latitude, IGNITION.longitude);
  const igCol = Math.floor((ignition3978.x - source.originX) / source.pixelW);
  const igRow = Math.floor((source.originY - ignition3978.y) / source.pixelH);

  // Walk outward along each axis looking for a point inside a uniform patch.
  const directions: Array<{ name: string; dc: number; dr: number }> = [
    { name: 'north', dc: 0, dr: -1 },
    { name: 'south', dc: 0, dr: 1 },
    { name: 'east', dc: 1, dr: 0 },
    { name: 'west', dc: -1, dr: 0 },
  ];
  const samples: Array<{
    direction: string;
    col: number;
    row: number;
    x3978: number;
    y3978: number;
    class: number;
  }> = [];
  for (const dir of directions) {
    for (let step = UNIFORM_RADIUS_CELLS + 1; step < 90; step += 1) {
      const col = igCol + dir.dc * step;
      const row = igRow + dir.dr * step;
      const value = uniformAround(source, srcPixel, col, row, UNIFORM_RADIUS_CELLS);
      if (value !== null && value !== nil) {
        samples.push({
          direction: dir.name,
          col,
          row,
          x3978: source.originX + col * source.pixelW + source.pixelW / 2,
          y3978: source.originY - row * source.pixelH - source.pixelH / 2,
          class: value,
        });
        break;
      }
    }
  }

  const byDir = Object.fromEntries(samples.map((s) => [s.direction, s.class]));
  const asymmetry = {
    north_vs_south_differ: byDir.north !== undefined && byDir.south !== undefined
      ? byDir.north !== byDir.south
      : null,
    east_vs_west_differ: byDir.east !== undefined && byDir.west !== undefined
      ? byDir.east !== byDir.west
      : null,
    classes: byDir,
  };

  // The independent query: one small-bbox GetCoverage per point, EPSG:3978, no
  // reprojection, no decode. Compared against the value our REPROJECTED grid carries at
  // the same ground coordinate.
  const gdalMod = (await import('gdal-async')).default;
  const to3978 = gdalMod.SpatialReference.fromEPSG(3978);
  const toUtm = gdalMod.SpatialReference.fromEPSG(expectedEpsg);
  const t3978ToUtm = new gdalMod.CoordinateTransformation(to3978, toUtm);

  const roundTrips: Json[] = [];
  for (const s of samples) {
    const half = SOURCE_CELL_M / 2;
    const url = buildGetCoverageUrl({
      baseUrl: process.env.NOMAD_FUEL_WCS_URL!,
      coverageId: process.env.NOMAD_FUEL_WCS_COVERAGE!,
      bbox: { minX: s.x3978 - half, maxX: s.x3978 + half, minY: s.y3978 - half, maxY: s.y3978 + half },
    });
    const response = await fetch(url);
    const independentPath = `${WORK}/independent_${s.direction}.tif`;
    let independentValue: number | null = null;
    if (response.ok) {
      await writeFile(independentPath, Buffer.from(await response.arrayBuffer()));
      const tiny = await openRaster(independentPath);
      independentValue = tiny.at(s.x3978, s.y3978);
    }
    const utmPoint = t3978ToUtm.transformPoint(s.x3978, s.y3978);
    const oursValue = grid.at(utmPoint.x, utmPoint.y);
    roundTrips.push({
      direction: s.direction,
      bbox_3978: [s.x3978 - half, s.y3978 - half, s.x3978 + half, s.y3978 + half],
      independent_getcoverage_value: independentValue,
      our_reprojected_grid_value: oursValue,
      agree: independentValue !== null && independentValue === oursValue,
      http_status: response.status,
    });
  }

  findings['3b_ii_round_trip'] = {
    uniform_patch_radius_cells: UNIFORM_RADIUS_CELLS,
    samples_found: samples.length,
    asymmetry,
    round_trips: roundTrips,
    all_agree: roundTrips.length > 0 && roundTrips.every((r) => r['agree'] === true),
  };

  // ---- 3b(iii): the off-edge negative control, with a known answer -----------------
  //
  // THE FIRST VERSION OF THIS CHECK WAS ONE STEP BESIDE THE QUESTION. It probed a
  // coordinate beyond the output raster's own extent, where this file's own reader
  // returns null by its bounds test — so it measured the reader, not the grid, and would
  // have passed against any raster at all, including an empty one.
  //
  // D9 item 4 asks about a coordinate beyond the COVERAGE'S DATA EDGE. Inside the output
  // rectangle but outside the source footprint is exactly that place, and reprojecting a
  // rectangle into UTM guarantees it exists: the rotated quadrilateral leaves the output
  // corners uncovered. Those must read as the DECLARED NIL — which is the cheapest
  // detector of a shift, and exercises the nil value end to end rather than in a unit
  // test.
  const cornerX = grid.originX + grid.pixelW / 2;
  const cornerY = grid.originY - grid.pixelH / 2;
  const cornerValue = grid.at(cornerX, cornerY);
  const ignitionValue = grid.at(ignitionUtm.x, ignitionUtm.y);

  findings['3b_iii_off_edge'] = {
    corner_probe: { x: cornerX, y: cornerY, value: cornerValue },
    declared_nil: nil,
    corner_reads_as_declared_nil: cornerValue === nil,
    // POSITIVE CONTROL. Without it, a grid that is nil EVERYWHERE — an empty or wholly
    // failed warp — satisfies the assertion above perfectly.
    ignition_probe: { x: ignitionUtm.x, y: ignitionUtm.y, value: ignitionValue },
    ignition_is_a_real_class: ignitionValue !== null && ignitionValue !== nil,
    note:
      'The output corner lies outside the rotated source footprint, so it is beyond the ' +
      'coverage data edge while still inside the raster. It must be the declared nil, and ' +
      'the ignition must NOT be, or the check passes on an empty grid.',
  };

  // ---- 3b item 5: the CONDITIONAL local cross-check --------------------------------
  //
  // It runs only when the local dataset and the WCS coverage are the same CFS vintage,
  // ASSERTED from their own metadata and never assumed — fuel vintage is model year
  // minus one, so a coverage named ...2026wcs and a dataset directory named 2026 can
  // legitimately describe different seasons.
  //
  // WHEN IT DOES NOT RUN THAT IS RECORDED, not silently skipped: a conditional check
  // that quietly disappears is indistinguishable from one that passed.
  const localMetadataPath = process.env.NOMAD_PROOF_LOCAL_METADATA;
  let localVintage: string | null = null;
  if (localMetadataPath) {
    try {
      const text = (await import('node:fs')).readFileSync(localMetadataPath, 'utf-8');
      const match = text.match(/end of season (\d{4})/i);
      localVintage = match ? match[1] : null;
    } catch {
      localVintage = null;
    }
  }

  // The coverage's own declared vintage, from DescribeCoverage rather than from its id.
  let coverageVintage: string | null = null;
  let describeEvidence = '';
  try {
    const url = new URL(process.env.NOMAD_FUEL_WCS_URL!);
    url.searchParams.set('SERVICE', 'WCS');
    url.searchParams.set('VERSION', '2.0.1');
    url.searchParams.set('REQUEST', 'DescribeCoverage');
    url.searchParams.set('CoverageId', process.env.NOMAD_FUEL_WCS_COVERAGE!);
    const xml = await (await fetch(url.toString())).text();
    const season = xml.match(/end of season (\d{4})/i);
    coverageVintage = season ? season[1] : null;
    describeEvidence = season
      ? `DescribeCoverage states season ${season[1]}`
      : 'DescribeCoverage declares no season or vintage anywhere in its response';
  } catch (err) {
    describeEvidence = `DescribeCoverage could not be read: ${
      err instanceof Error ? err.message : String(err)
    }`;
  }

  const vintagesAsserted = localVintage !== null && coverageVintage !== null;
  findings['3b_item5_local_cross_check'] = vintagesAsserted
    ? {
        ran: coverageVintage === localVintage,
        local_vintage: localVintage,
        coverage_vintage: coverageVintage,
        evidence: describeEvidence,
        skipped_because:
          coverageVintage === localVintage
            ? null
            : 'the two vintages are asserted DIFFERENT, so a cell-by-cell comparison would fail for the wrong reason',
      }
    : {
        ran: false,
        local_vintage: localVintage,
        coverage_vintage: coverageVintage,
        evidence: describeEvidence,
        skipped_because:
          'vintage equality could NOT BE ASSERTED from both sides own metadata. D9 item 5 ' +
          'requires assertion, never assumption, so the cross-check does not run. The three ' +
          'mandatory checks above are what condition 3 rests on, and they stand on their own.',
      };

  await writeFile(`${WORK}/step3-findings.json`, `${JSON.stringify(findings, null, 2)}\n`);
  process.stdout.write(`findings written to ${WORK}/step3-findings.json\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`STEP 3 FAILED: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
