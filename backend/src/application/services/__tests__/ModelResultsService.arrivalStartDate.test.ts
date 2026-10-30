/**
 * #482 — the arrival-time output must not carry a start date it did not read.
 *
 * The defect: when a sim directory had no `timeRange`, this service derived a model year
 * from `weather.csv` and, failing that, substituted `new Date().getFullYear()`. A 2023
 * reconstruction was reported as starting in the current year, feeding `offsetDay` and the
 * arrival raster's time coordinate.
 *
 * ROOT CAUSE, which is why the fix is a deletion rather than a better fallback. Franco
 * asked why we were coding around a symptom, and the answer is in `modelStartDate.ts`:
 * there CANNOT be a weather.csv fallback (#479). The weather Date column is a bare LOCAL
 * timestamp, and the zone needed to read it lives in `output-config.json` — the very file
 * whose absence puts us in this branch. So at the moment a fallback would run, the
 * information needed to use it correctly is by definition unavailable.
 *
 * `readModelStartDate` is therefore the single authoritative source, and it returns
 * undefined rather than guessing. This service already called it; the arrival branch was
 * hand-rolling a second, forbidden fallback beside it.
 *
 * THE DISCRIMINATING TEST is the first one below: a `weather.csv` containing a perfectly
 * parseable date is present, and the output must STILL have no start date. A test that
 * merely omitted the weather file could not tell the deletion from the old code path
 * failing to find a year.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mockResultRepo = {
  findById: vi.fn(),
  findByModelId: vi.fn(),
  save: vi.fn(),
};
const mockJobRepo = { findByModelId: vi.fn() };

vi.mock('../../../infrastructure/database/index.js', () => ({
  getResultRepository: () => mockResultRepo,
  getJobRepository: () => mockJobRepo,
}));

const mockResolveResultFilePath = vi.fn();
vi.mock('../../../infrastructure/firestarr/FireSTARRInputGenerator.js', () => ({
  resolveResultFilePath: (p: string) => mockResolveResultFilePath(p),
}));

const mockFindArrivalTifs = vi.fn();
const mockExtractDeterministicPerimeters = vi.fn();
vi.mock('../../../infrastructure/firestarr/index.js', () => ({
  findArrivalTifs: (...a: unknown[]) => mockFindArrivalTifs(...a),
  extractDeterministicPerimeters: (...a: unknown[]) => mockExtractDeterministicPerimeters(...a),
}));

import { getModelResultsService, resetModelResultsService } from '../ModelResultsService.js';
import type { IFireModelingEngine } from '../../interfaces/IFireModelingEngine.js';
import type { FireModelId } from '../../../domain/entities/index.js';

function makeEngine(overrides: Partial<IFireModelingEngine> = {}): IFireModelingEngine {
  return { getStatus: vi.fn(), getResults: vi.fn(), ...overrides } as unknown as IFireModelingEngine;
}

interface ArrivalMetadata {
  startDate?: unknown;
  startJulian?: number;
  offsetDay?: number;
}

describe('#482 — arrival-time startDate is never invented', () => {
  let simDir: string;

  beforeEach(() => {
    resetModelResultsService();
    vi.clearAllMocks();
    simDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomad-482-arrival-'));
    // simDir is derived as path.dirname(resolveResultFilePath(filePath)).
    mockResolveResultFilePath.mockImplementation(() => path.join(simDir, 'out.tif'));
    mockFindArrivalTifs.mockReturnValue({ offsetDay: 170, endJulian: 173, julianDays: [170, 171, 172] });
    mockExtractDeterministicPerimeters.mockResolvedValue({ success: false });
    mockResultRepo.findByModelId.mockResolvedValue([]);
    mockResultRepo.save.mockResolvedValue(undefined);
  });

  afterEach(() => {
    fs.rmSync(simDir, { recursive: true, force: true });
  });

  async function runGetResults() {
    const engine = makeEngine({
      getStatus: vi.fn().mockResolvedValue({
        state: 'completed',
        progress: 100,
        startedAt: new Date('2026-06-01T00:00:00Z'),
        completedAt: new Date('2026-06-01T00:01:00Z'),
        updatedAt: new Date('2026-06-01T00:01:00Z'),
      }),
      getResults: vi.fn().mockResolvedValue([
        {
          id: 'r-1',
          fireModelId: 'model-1' as FireModelId,
          outputType: 'probability',
          format: 'geotiff',
          metadata: { filePath: 'sim/out.tif' },
          getDisplayName: () => 'Display Name',
        },
      ]),
    });

    const svc = getModelResultsService(engine);
    const res = await svc.getResults('model-1' as FireModelId, 'Name', 'firestarr');
    if (!res.success) throw new Error('expected getResults to succeed');
    return res.value;
  }

  function arrivalMetadata(value: { outputs: Array<{ type: string; metadata?: unknown }> }) {
    const arrival = value.outputs.find((o) => o.type === 'arrival_time');
    expect(arrival, 'an arrival_time output should be present').toBeDefined();
    return (arrival!.metadata ?? {}) as ArrivalMetadata;
  }

  it('THE DISCRIMINATOR: a parseable weather.csv date is present and is still NOT used', async () => {
    // Config exists but carries no timeRange — the branch under test.
    fs.writeFileSync(path.join(simDir, 'output-config.json'), JSON.stringify({ outputMode: 'deterministic' }), 'utf-8');
    // A date the OLD code would have happily parsed into a model year.
    fs.writeFileSync(
      path.join(simDir, 'weather.csv'),
      'Scenario,DateTime,Temp\nS1,2023-06-19 13:00,21.5\n',
      'utf-8'
    );

    const meta = arrivalMetadata(await runGetResults());

    // No start date at all — not 2023, and emphatically not the current year.
    expect(meta.startDate).toBeUndefined();
  });

  it('records no start date when there is no weather file either', async () => {
    fs.writeFileSync(path.join(simDir, 'output-config.json'), JSON.stringify({ outputMode: 'deterministic' }), 'utf-8');

    const meta = arrivalMetadata(await runGetResults());

    expect(meta.startDate).toBeUndefined();
  });

  it('DOES record the start date when timeRange is present — the authoritative source', async () => {
    fs.writeFileSync(
      path.join(simDir, 'output-config.json'),
      JSON.stringify({ outputMode: 'deterministic', timeRange: { start: '2023-06-19T18:00:00Z', end: '2023-06-22T18:00:00Z' } }),
      'utf-8'
    );

    const meta = arrivalMetadata(await runGetResults());

    expect(meta.startDate).toBe('2023-06-19T18:00:00.000Z');
    // And the Julian window comes from the configured start, not the file count.
    expect(meta.startJulian).toBe(170);
  });
});
