/**
 * Tests for the arrival-perimeter animation frame planner (refs #236).
 *
 * Pure math only — given a simulation start time and duration, produce the
 * list of hourly frames the animation will render. 7-day / 168-frame cap
 * keeps payload and GDAL work bounded for long sims.
 */

import { describe, it, expect } from 'vitest';
import {
  buildReclassifyExpression,
  computeAnimationFrames,
  extractArrivalAnimation,
  extractSimTimeRange,
  julianDayFromDate,
  julianToDate,
  parseSrsWktOutput,
  toAnimationFeatureCollection,
  toFireSTARRRasterJulianDay,
} from '../arrivalAnimation.js';

describe('computeAnimationFrames', () => {
  it('emits one hourly frame per simulation hour starting at offset 1', () => {
    const start = new Date('2026-04-18T00:00:00Z');
    const frames = computeAnimationFrames(start, 3);

    expect(frames).toEqual([
      { offsetHours: 1, isoTime: '2026-04-18T01:00:00.000Z' },
      { offsetHours: 2, isoTime: '2026-04-18T02:00:00.000Z' },
      { offsetHours: 3, isoTime: '2026-04-18T03:00:00.000Z' },
    ]);
  });

  it('caps at 168 frames (7 days) for a longer simulation', () => {
    const start = new Date('2026-04-18T00:00:00Z');
    const frames = computeAnimationFrames(start, 240);

    expect(frames).toHaveLength(168);
    expect(frames[0].offsetHours).toBe(1);
    expect(frames[frames.length - 1].offsetHours).toBe(168);
  });

  it('honors an explicit cap shorter than the default', () => {
    const start = new Date('2026-04-18T00:00:00Z');
    const frames = computeAnimationFrames(start, 48, 24);

    expect(frames).toHaveLength(24);
  });

  it('returns an empty array for a sub-hour duration', () => {
    const start = new Date('2026-04-18T00:00:00Z');
    expect(computeAnimationFrames(start, 0.5)).toEqual([]);
  });
});

describe('extractSimTimeRange', () => {
  it('reads timeRange.start and timeRange.end from a model config and returns duration in hours', () => {
    const config = {
      timeRange: {
        start: '2026-04-18T00:00:00Z',
        end: '2026-04-21T00:00:00Z',
      },
    };

    expect(extractSimTimeRange(config)).toEqual({
      simStart: new Date('2026-04-18T00:00:00Z'),
      durationHours: 72,
    });
  });

  it('throws when timeRange is missing', () => {
    expect(() => extractSimTimeRange({})).toThrow(/timeRange/i);
  });

  it('throws when start or end cannot be parsed as a date', () => {
    expect(() =>
      extractSimTimeRange({ timeRange: { start: 'not-a-date', end: '2026-04-21T00:00:00Z' } }),
    ).toThrow(/invalid/i);
  });
});

describe('toAnimationFeatureCollection', () => {
  const simStart = new Date('2026-04-18T00:00:00Z');
  const makeFeature = (dn: number) => ({
    type: 'Feature' as const,
    properties: { DN: dn },
    geometry: {
      type: 'Polygon' as const,
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]],
    },
  });

  it('drops DN=0 (unburned) and renames DN to offsetHours + isoTime', () => {
    const raw = {
      type: 'FeatureCollection' as const,
      features: [makeFeature(0), makeFeature(1), makeFeature(5)],
    };

    const result = toAnimationFeatureCollection(raw, simStart);

    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toHaveLength(2);
    expect(result.features[0].properties).toEqual({
      offsetHours: 1,
      isoTime: '2026-04-18T01:00:00.000Z',
    });
    expect(result.features[1].properties).toEqual({
      offsetHours: 5,
      isoTime: '2026-04-18T05:00:00.000Z',
    });
  });

  it('preserves polygon geometry verbatim', () => {
    const raw = {
      type: 'FeatureCollection' as const,
      features: [makeFeature(2)],
    };

    const result = toAnimationFeatureCollection(raw, simStart);

    expect(result.features[0].geometry).toEqual({
      type: 'Polygon',
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]],
    });
  });
});

describe('parseSrsWktOutput', () => {
  // Old GDAL/PROJ (≤ PROJ 6, e.g. macOS Homebrew gdal at ~3.4) emits the
  // entire WKT on a single line, no leading blank. The existing
  // `.split(/\r?\n/)[0].trim()` worked here by accident.
  it('returns the WKT unchanged for old single-line PROJ output', () => {
    const oldGdalOutput =
      'PROJCS["NAD83 / Canada Atlas Lambert",GEOGCS["NAD83",DATUM["North_American_Datum_1983",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Lambert_Conformal_Conic_2SP"],PARAMETER["latitude_of_origin",49],PARAMETER["central_meridian",-95],UNIT["metre",1]]\n';
    const result = parseSrsWktOutput(oldGdalOutput);
    expect(result.startsWith('PROJCS[')).toBe(true);
    expect(result.endsWith(']]')).toBe(true);
    expect(result).not.toContain('\n');
  });

  // New GDAL/PROJ (≥ PROJ 7, e.g. Debian-based container with gdal 3.6+)
  // emits a leading blank line followed by 30+ pretty-printed indented
  // lines. Empirically reproduced on staging Apr 27 2026 — the bug.
  it('returns a usable multi-line WKT for new pretty-printed PROJ output', () => {
    const newGdalOutput = [
      '', // <— leading blank line is what bit us
      'PROJCRS["unnamed",',
      '    BASEGEOGCRS["unknown",',
      '        DATUM["unnamed",',
      '            ELLIPSOID["GRS 1980",6378137,298.257222101004,',
      '                LENGTHUNIT["metre",1],',
      '                ID["EPSG",7019]]],',
      '        PRIMEM["Greenwich",0,',
      '            ANGLEUNIT["unknown",0.0174532925199433]]],',
      '    CONVERSION["Transverse Mercator",',
      '        METHOD["Transverse Mercator", ID["EPSG",9807]]],',
      '    CS[Cartesian,2],',
      '        AXIS["easting",east], AXIS["northing",north],',
      '        LENGTHUNIT["metre",1]]',
      '',
    ].join('\n');
    const result = parseSrsWktOutput(newGdalOutput);
    // Must NOT be empty (the bug) and must include the closing `]]`
    // so ogr2ogr can parse it as a complete SRS definition.
    expect(result).not.toBe('');
    expect(result.startsWith('PROJCRS[')).toBe(true);
    expect(result).toContain('Transverse Mercator');
    expect(result.endsWith(']]')).toBe(true);
  });

  it('handles CRLF line endings without losing content', () => {
    const crlfOutput = 'PROJCS["x",GEOGCS["y",DATUM["z",SPHEROID["w",1,1]]]]\r\n';
    expect(parseSrsWktOutput(crlfOutput)).toBe('PROJCS["x",GEOGCS["y",DATUM["z",SPHEROID["w",1,1]]]]');
  });
});

describe('toFireSTARRRasterJulianDay', () => {
  it('returns julianDayFromDate minus 1 (FireSTARR rasters use 0-indexed Julian)', () => {
    // Hay River simStart from the Apr 25 2026 regression: raster max for the
    // simStart pixel was empirically 169.79167. Our julianDayFromDate would
    // give 170.79167, so the converter must subtract exactly 1.0.
    const simStart = new Date('2023-06-19T19:00:00Z');
    expect(julianDayFromDate(simStart)).toBeCloseTo(170.79167, 4);
    expect(toFireSTARRRasterJulianDay(simStart)).toBeCloseTo(169.79167, 4);
  });
});

describe('julianDayFromDate', () => {
  it('returns 1.0 at Jan 1 00:00 UTC (day-of-year convention)', () => {
    expect(julianDayFromDate(new Date('2026-01-01T00:00:00Z'))).toBe(1);
  });

  it('includes the fractional time of day', () => {
    expect(julianDayFromDate(new Date('2026-01-01T12:00:00Z'))).toBe(1.5);
  });

  it('produces the expected day number for a mid-year date', () => {
    // 2026-04-18 = Jan(31) + Feb(28) + Mar(31) + Apr 1..17(17) = 107 days after Jan 1 00:00.
    expect(julianDayFromDate(new Date('2026-04-18T00:00:00Z'))).toBe(108);
  });
});

describe('julianToDate', () => {
  it('is the inverse of julianDayFromDate', () => {
    const d = new Date('2023-06-19T11:08:30.000Z');
    const j = julianDayFromDate(d);
    expect(julianToDate(j, 2023).toISOString()).toBe('2023-06-19T11:08:30.000Z');
  });

  it('returns Jan 1 00:00 UTC for julianDay 1.0', () => {
    expect(julianToDate(1, 2023).toISOString()).toBe('2023-01-01T00:00:00.000Z');
  });

  it('returns mid-day noon for a .5 fraction', () => {
    expect(julianToDate(170.5, 2023).toISOString()).toBe('2023-06-19T12:00:00.000Z');
  });
});

describe('buildReclassifyExpression', () => {
  it('emits a gdal_calc expression referencing simStartJulian and the frame cap', () => {
    const expr = buildReclassifyExpression(108.0, 168);
    expect(expr).toContain('108');
    expect(expr).toContain('168');
    expect(expr).toContain('24'); // hours per day
    expect(expr).toContain('A'); // input band
  });

  it('clamps pre-warmup cells (A <= simStart, A > 0) into frame 1 instead of dropping', () => {
    // FireSTARR emits arrival values for warmup growth that lands outside
    // the user's ignition polygon BEFORE the user's simStart. PR #251 had
    // dropped them, but Papa observed (Apr 26 2026) that the resulting
    // animation skipped the visible "halo" of initial growth. The expression
    // must clamp these into DN=1 (initial state) rather than dropping them.
    const expr = buildReclassifyExpression(170.7917, 168);
    expect(expr).toContain('maximum(');
    // Must still gate on A>0 so true NoData (unburned) cells stay dropped.
    expect(expr).toContain('A>0');
    // The cap must still bound the upper end.
    expect(expr).toContain('168');
  });
});

describe('extractArrivalAnimation (orchestrator)', () => {
  function stubDeps(readJSONResult: unknown = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { DN: 0 },
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
      },
      {
        type: 'Feature',
        properties: { DN: 3 },
        geometry: { type: 'Polygon', coordinates: [[[2, 2], [3, 2], [3, 3], [2, 2]]] },
      },
    ],
  }) {
    const execCalls: string[] = [];
    const rmrfCalls: string[] = [];
    const deps = {
      exec: (file: string, args: string[]) => {
        execCalls.push([file, ...args].join(' '));
      },
      mkdtemp: (prefix: string) => `/tmp/${prefix}test`,
      readJSON: () => readJSONResult,
      rmrf: (path: string) => {
        rmrfCalls.push(path);
      },
    };
    return { deps, execCalls, rmrfCalls };
  }

  it('runs gdal_calc → gdal_polygonize → ogr2ogr and returns the transformed FeatureCollection', async () => {
    const { deps, execCalls } = stubDeps();

    const result = await extractArrivalAnimation(
      {
        arrivalPath: '/sims/m1/arrival.tif',
        simStart: new Date('2026-04-18T00:00:00Z'),
        durationHours: 72,
      },
      deps,
    );

    const tools = execCalls.map((c) => c.split(/\s+/)[0]);
    expect(tools).toEqual(['gdal_calc.py', 'gdal_polygonize.py', 'ogr2ogr']);
    expect(execCalls[0]).toContain('/sims/m1/arrival.tif');

    // ogr2ogr must NOT pass -s_srs: gdal_polygonize embeds the source raster's
    // SRS into the GPKG, and passing a multi-line WKT through `-s_srs` causes
    // shell-arg splitting that breaks ogr2ogr (Apr 27 2026 staging regression).
    expect(execCalls[2]).not.toContain('-s_srs');
    expect(execCalls[2]).toContain('EPSG:4326');

    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toHaveLength(1);
    expect(result.features[0].properties.offsetHours).toBe(3);
  });

  it('cleans up the temp directory on success', async () => {
    const { deps, rmrfCalls } = stubDeps();

    await extractArrivalAnimation(
      {
        arrivalPath: '/sims/m1/arrival.tif',
        simStart: new Date('2026-04-18T00:00:00Z'),
        durationHours: 24,
      },
      deps,
    );

    expect(rmrfCalls).toHaveLength(1);
    expect(rmrfCalls[0]).toContain('nomad-anim-');
  });

  it('anchors isoTime labels to params.simStart (user-configured sim start)', async () => {
    const { deps } = stubDeps();

    const result = await extractArrivalAnimation(
      {
        arrivalPath: '/sims/m1/arrival.tif',
        simStart: new Date('2026-06-19T19:00:00Z'),
        durationHours: 72,
      },
      deps,
    );

    // Feature with DN=3 → isoTime = simStart + 3h = 2026-06-19T22:00Z.
    expect(result.features[0].properties.isoTime).toBe('2026-06-19T22:00:00.000Z');
  });

  it('passes the FireSTARR-convention (0-indexed) sim start julian day into gdal_calc', async () => {
    const { deps, execCalls } = stubDeps();

    await extractArrivalAnimation(
      {
        arrivalPath: '/sims/m1/arrival.tif',
        simStart: new Date('2023-06-19T19:00:00Z'),
        durationHours: 72,
      },
      deps,
    );

    // Our julianDayFromDate(2023-06-19T19:00Z) = 170.7917 (Jan 1 = 1.0).
    // FireSTARR writes 0-indexed values (Jan 1 = 0.0) inside the raster,
    // so the value baked into the gdal_calc expression must be 169.7917.
    // If we pass 170.7917 here, the first 24h of spread would be DN <= 0
    // and dropped from the animation (regression observed Apr 25 2026).
    const calcCall = execCalls[0];
    expect(calcCall).toContain('169.79');
    expect(calcCall).not.toContain('170.79');
  });

  it('cleans up the temp directory even when a command fails', async () => {
    const { deps, rmrfCalls } = stubDeps();
    let callCount = 0;
    deps.exec = () => {
      callCount++;
      if (callCount === 2) throw new Error('gdal_polygonize exploded');
    };

    await expect(
      extractArrivalAnimation(
        {
          arrivalPath: '/sims/m1/arrival.tif',
          simStart: new Date('2026-04-18T00:00:00Z'),
          durationHours: 24,
        },
        deps,
      ),
    ).rejects.toThrow(/exploded/);

    expect(rmrfCalls).toHaveLength(1);
  });
});
