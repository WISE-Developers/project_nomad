/**
 * Missing fuel dataset is reported, not discovered by the engine — issue #330.
 *
 * A model whose year has no installed fuel dataset failed with:
 *
 *   Model Execution: Failed
 *   Process exited with code 1
 *
 * The system knew, twice over, before the container was ever launched: the
 * input generator logged "No fuel grid found containing coordinates" and
 * carried on, and the fuel dataset catalog had already resolved that year to
 * nothing. Both were discarded and the user got an exit code.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { FireSTARRInputGenerator } from '../FireSTARRInputGenerator.js';
import { createFireModelId } from '../../../domain/entities/FireModel.js';
import type { FireSTARRParams, WeatherHourlyData } from '../types.js';

/** Hay River, NWT — the location from the report. */
const LAT = 60.823286;
const LON = -115.704839;

function weather(hours = 26): WeatherHourlyData[] {
  const base = new Date('2024-06-19T12:00:00Z').getTime();
  return Array.from({ length: hours }, (_, i) => ({
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

describe('FireSTARRInputGenerator — missing fuel dataset (#330)', () => {
  let tempDir: string;
  let gridRoot: string;
  let generator: FireSTARRInputGenerator;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'firestarr-fuel-test-'));
    gridRoot = join(tempDir, 'generated', 'grid', '100m');
    // Two vintages installed, exactly as in the report: 2023 and 2026.
    await mkdir(join(gridRoot, '2023'), { recursive: true });
    await mkdir(join(gridRoot, '2026'), { recursive: true });

    generator = new FireSTARRInputGenerator({
      simsBasePath: join(tempDir, 'sims'),
      gridRoot,
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('fails before launching anything when the model year has no fuel coverage', async () => {
    const result = await generator.generate(createFireModelId('fuel-330'), params(2024));
    expect(result.success).toBe(false);
  });

  it('names the year the user actually asked for', async () => {
    const result = await generator.generate(createFireModelId('fuel-330-year'), params(2024));
    expect(String((result as { error?: { message?: string } }).error?.message)).toMatch(/2024/);
  });

  it('says what to do about it rather than only that it failed', async () => {
    const result = await generator.generate(createFireModelId('fuel-330-fix'), params(2024));
    const message = String((result as { error?: { message?: string } }).error?.message);

    expect(message).toMatch(/fuel/i);
    expect(message).toMatch(/install/i);
  });

  it('lists the vintages that ARE installed, so the choice is obvious', async () => {
    const result = await generator.generate(createFireModelId('fuel-330-list'), params(2024));
    const message = String((result as { error?: { message?: string } }).error?.message);

    expect(message).toMatch(/2023/);
    expect(message).toMatch(/2026/);
  });

  it('never mentions an exit code — that was the useless part', async () => {
    const result = await generator.generate(createFireModelId('fuel-330-noexit'), params(2024));
    const message = String((result as { error?: { message?: string } }).error?.message);

    expect(message).not.toMatch(/exit code/i);
  });
});
