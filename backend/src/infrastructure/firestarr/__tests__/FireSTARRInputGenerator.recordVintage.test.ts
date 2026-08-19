/**
 * The fuel vintage is RECORDED when the model runs — issue #331.
 *
 * The results view resolved the vintage when the page was viewed, so installing
 * a fuel year later retroactively rewrote what past runs claimed to have used.
 * A historical run is a record of what happened; it must not change because the
 * machine changed afterwards.
 *
 * The generator already resolves the grid path (it must, since #330), so the
 * answer is in hand at exactly the moment it is true.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import { mkdtemp, rm, mkdir, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { FireSTARRInputGenerator } from '../FireSTARRInputGenerator.js';
import { createFireModelId } from '../../../domain/entities/FireModel.js';
import type { FireSTARRParams, WeatherHourlyData } from '../types.js';

const LAT = 60.823286;
const LON = -115.704839;

function weather(): WeatherHourlyData[] {
  const base = new Date('2024-06-19T12:00:00Z').getTime();
  return Array.from({ length: 26 }, (_, i) => ({
    date: new Date(base + i * 3600000),
    temp: 20, rh: 45, ws: 10, wd: 180, precip: 0,
    ffmc: 85, dmc: 30, dc: 200, isi: 5, bui: 40, fwi: 10,
  })) as WeatherHourlyData[];
}

function params(year: number): FireSTARRParams {
  return {
    latitude: LAT,
    longitude: LON,
    startDate: new Date(`${year}-06-19T12:00:00Z`),
    startTime: '12:00',
    timezone: 'America/Edmonton',
    weatherData: weather(),
    previousFFMC: 85,
    previousDMC: 30,
    previousDC: 200,
  } as FireSTARRParams;
}

describe('FireSTARRInputGenerator records the fuel vintage (#331)', () => {
  let tempDir: string;
  let gridRoot: string;
  let simsBasePath: string;
  let generator: FireSTARRInputGenerator;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'firestarr-vintage-test-'));
    gridRoot = join(tempDir, 'generated', 'grid', '100m');
    simsBasePath = join(tempDir, 'sims');
    await mkdir(join(gridRoot, '2024'), { recursive: true });
    await mkdir(join(gridRoot, 'default'), { recursive: true });

    generator = new FireSTARRInputGenerator({ simsBasePath, gridRoot });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function recordedFor(modelId: string, gridPath: string, year: number) {
    vi.spyOn(generator, 'findFuelGridForCoordinates').mockResolvedValue(gridPath);

    const result = await generator.generate(createFireModelId(modelId), params(year));
    expect(result.success).toBe(true);

    const raw = await readFile(join(simsBasePath, modelId, 'fuel-vintage.json'), 'utf-8');
    return JSON.parse(raw);
  }

  it('records the vintage that was actually used', async () => {
    const recorded = await recordedFor('vintage-match', join(gridRoot, '2024', 'fuel_11_0.tif'), 2024);

    expect(recorded.vintage).toBe('2024');
    expect(recorded.requestedYear).toBe(2024);
    expect(recorded.matchedRequestedYear).toBe(true);
    expect(recorded.usedFallback).toBe(false);
  });

  it('records that a default dataset stood in for a missing year', async () => {
    // The silent {year}/ -> default/ fallback is exactly what a historical run
    // needs to admit to, since the output depends on it.
    const recorded = await recordedFor('vintage-fallback', join(gridRoot, 'default', 'fuel_11_0.tif'), 2024);

    expect(recorded.vintage).toBe('default');
    expect(recorded.requestedYear).toBe(2024);
    expect(recorded.matchedRequestedYear).toBe(false);
    expect(recorded.usedFallback).toBe(true);
  });

  it('records the grid path, so the exact file used is traceable', async () => {
    const gridPath = join(gridRoot, '2024', 'fuel_11_0.tif');
    const recorded = await recordedFor('vintage-path', gridPath, 2024);

    expect(recorded.gridPath).toBe(gridPath);
  });

  it('records when the run happened, not when it is read', async () => {
    const recorded = await recordedFor('vintage-when', join(gridRoot, '2024', 'fuel_11_0.tif'), 2024);
    expect(Date.parse(recorded.recordedAt)).not.toBeNaN();
  });
});
