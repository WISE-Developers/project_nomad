/**
 * The extent limit must actually be enforced at the call site (#432).
 *
 * simulationExtent.test.ts proves the measurement is right. This proves the
 * generator USES it — a check nothing calls is exactly the defect pattern
 * that shipped in #431, where a prop was honoured by a component nobody
 * handed the value to.
 *
 * It also pins that the run is refused BEFORE a working directory is created.
 * There is no reason to leave artifacts on disk for a simulation that cannot
 * be run, and a half-populated sim directory is its own source of confusion
 * later.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdtemp, rm, mkdir, access } from 'fs/promises';
import { tmpdir } from 'os';
import { FireSTARRInputGenerator } from '../FireSTARRInputGenerator.js';
import { createFireModelId } from '../../../domain/entities/FireModel.js';
import { SpatialGeometry } from '../../../domain/entities/index.js';
import type { FireSTARRParams, WeatherHourlyData } from '../types.js';

const LAT = 60.0;
const LON = -111.9;
const M_PER_DEG_LAT = 111_320;

function weather(): WeatherHourlyData[] {
  const base = new Date('2024-06-19T12:00:00Z').getTime();
  return Array.from({ length: 26 }, (_, i) => ({
    date: new Date(base + i * 3600000),
    temp: 20, rh: 45, ws: 10, wd: 180, precip: 0,
    ffmc: 85, dmc: 30, dc: 200, isi: 5, bui: 40, fwi: 10,
  })) as WeatherHourlyData[];
}

function polygonSpanningKm(widthKm: number, heightKm: number): SpatialGeometry {
  const dLat = (heightKm * 1000) / M_PER_DEG_LAT / 2;
  const dLon = (widthKm * 1000) / (M_PER_DEG_LAT * Math.cos((LAT * Math.PI) / 180)) / 2;
  return SpatialGeometry.fromPolygon([
    { lat: LAT - dLat, lon: LON - dLon },
    { lat: LAT - dLat, lon: LON + dLon },
    { lat: LAT + dLat, lon: LON + dLon },
    { lat: LAT + dLat, lon: LON - dLon },
    { lat: LAT - dLat, lon: LON - dLon },
  ]);
}

function params(perimeter?: SpatialGeometry): FireSTARRParams {
  return {
    latitude: LAT,
    longitude: LON,
    startDate: new Date('2024-06-19T12:00:00Z'),
    startTime: '12:00',
    timezone: 'America/Edmonton',
    weatherData: weather(),
    previousFFMC: 85,
    previousDMC: 30,
    previousDC: 200,
    perimeter,
  } as FireSTARRParams;
}

describe('FireSTARRInputGenerator refuses an over-size fire (#432)', () => {
  let tempDir: string;
  let simsBasePath: string;
  let generator: FireSTARRInputGenerator;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'firestarr-extent-'));
    simsBasePath = join(tempDir, 'sims');
    const gridRoot = join(tempDir, 'generated', 'grid', '100m');
    await mkdir(join(gridRoot, '2024'), { recursive: true });
    generator = new FireSTARRInputGenerator({ simsBasePath, gridRoot });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('fails rather than silently cropping an Alberta-to-Manitoba fire', async () => {
    const result = await generator.generate(createFireModelId('too-wide'), params(polygonSpanningKm(1300, 50)));

    expect(result.success).toBe(false);
  });

  it('explains the refusal in terms an operator can act on', async () => {
    const result = await generator.generate(createFireModelId('too-wide-msg'), params(polygonSpanningKm(1300, 50)));

    const message = result.success ? '' : String((result as { error: Error }).error.message);
    expect(message).toMatch(/409\.6\s*km/);   // the limit, stated exactly
    expect(message).toMatch(/4096/);          // where the limit comes from
    expect(message).toMatch(/crop/i);         // why it cannot simply run
    expect(message).toMatch(/split|smaller/i); // what to do instead
  });

  it('does not create a working directory for a run it will not make', async () => {
    const modelId = 'too-wide-nodir';
    await generator.generate(createFireModelId(modelId), params(polygonSpanningKm(1300, 50)));

    await expect(access(join(simsBasePath, modelId))).rejects.toThrow();
  });

  it('still refuses before the fuel lookup, which is the slower check', async () => {
    // No fuel grid is installed for 2024 in this fixture, so if the extent
    // check did not run first the failure would name fuel instead of size —
    // and the operator would go looking for the wrong problem.
    const result = await generator.generate(createFireModelId('order'), params(polygonSpanningKm(1300, 50)));

    const message = result.success ? '' : String((result as { error: Error }).error.message);
    expect(message).not.toMatch(/fuel/i);
  });
});
