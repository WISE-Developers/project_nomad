/**
 * A completed run must record WHO produced the fuel it used (#431).
 *
 * The setup screen shows the producer before a run — "2022 (start-of-2023 fuel
 * state) [Jordan Evens]" — but the per-run record did not carry it, so the
 * results panel, which is the permanent answer to "what fuel did this run
 * use", could only ever show half of it. Franco caught it by comparing the two
 * screens.
 *
 * The producer is read through IFuelDatasetCatalog rather than by parsing
 * dataset.json here. The catalog's own header warns "Keep the two in step — if
 * they diverge, the UI reports a vintage the run never used", and a second
 * reader of the same manifest is exactly how that divergence starts.
 *
 * The catalog is optional. A generator built without one still records
 * everything else and simply omits the producer — a run must never fail
 * because provenance could not be looked up.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import { mkdtemp, rm, mkdir, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { FireSTARRInputGenerator } from '../FireSTARRInputGenerator.js';
import { createFireModelId } from '../../../domain/entities/FireModel.js';
import type { IFuelDatasetCatalog } from '../../../application/interfaces/IFuelDatasetCatalog.js';
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

/** Resolves like the real catalog, with provenance attached. */
function catalogWithProducer(producer: string): IFuelDatasetCatalog {
  return {
    listInstalled: async () => [],
    resolveForYear: async (modelYear: number) => ({
      requestedYear: modelYear,
      datasetYear: 2024,
      fuelVintage: 2023,
      matchedRequestedYear: true,
      usedFallback: false,
      dataset: { datasetYear: 2024, producer },
    }),
  };
}

describe('FireSTARRInputGenerator records the fuel producer (#431)', () => {
  let tempDir: string;
  let gridRoot: string;
  let simsBasePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'firestarr-producer-test-'));
    gridRoot = join(tempDir, 'generated', 'grid', '100m');
    simsBasePath = join(tempDir, 'sims');
    await mkdir(join(gridRoot, '2024'), { recursive: true });
    await mkdir(join(gridRoot, 'default'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function recordFor(
    generator: FireSTARRInputGenerator,
    modelId: string,
  ): Promise<Record<string, unknown>> {
    vi.spyOn(generator, 'findFuelGridForCoordinates')
      .mockResolvedValue(join(gridRoot, '2024', 'fuel_11_0.tif'));

    const result = await generator.generate(createFireModelId(modelId), params(2024));
    expect(result.success).toBe(true);

    return JSON.parse(await readFile(join(simsBasePath, modelId, 'fuel-vintage.json'), 'utf-8'));
  }

  it('writes the producer from the dataset catalog', async () => {
    const generator = new FireSTARRInputGenerator({
      simsBasePath,
      gridRoot,
      datasetCatalog: catalogWithProducer('Jordan Evens'),
    });

    const recorded = await recordFor(generator, 'producer-recorded');

    expect(recorded.producer).toBe('Jordan Evens');
    // The rest of the record is unchanged by this.
    expect(recorded.vintage).toBe('2024');
    expect(recorded.requestedYear).toBe(2024);
  });

  it('records everything else when no catalog is wired in', async () => {
    const generator = new FireSTARRInputGenerator({ simsBasePath, gridRoot });

    const recorded = await recordFor(generator, 'producer-absent');

    expect(recorded.producer).toBeUndefined();
    expect(recorded.vintage).toBe('2024');
    expect(recorded.matchedRequestedYear).toBe(true);
  });

  it('still records the run when the catalog throws', async () => {
    // Provenance is a nicety; the run is the valuable thing. A catalog that
    // cannot read its manifest must not cost us the vintage record too.
    const generator = new FireSTARRInputGenerator({
      simsBasePath,
      gridRoot,
      datasetCatalog: {
        listInstalled: async () => [],
        resolveForYear: async () => { throw new Error('manifest unreadable'); },
      },
    });

    const recorded = await recordFor(generator, 'producer-throws');

    expect(recorded.producer).toBeUndefined();
    expect(recorded.vintage).toBe('2024');
  });
});
