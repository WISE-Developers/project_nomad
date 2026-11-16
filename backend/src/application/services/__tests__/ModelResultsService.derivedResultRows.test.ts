/**
 * #536 — the perimeter and arrival-time products the GUI serves must also be
 * reachable over MCP.
 *
 * ROOT CAUSE, which is why this test asserts on `resultRepo.save` rather than on
 * the returned outputs: the derivation of these two products runs DOWNSTREAM of
 * persistence, and into a different type.
 *
 *   1. `getResults()` obtains ModelResult rows and persists them
 *      (ModelResultsService.ts:294 disk-harvest path, :317 current-session path).
 *   2. Only AFTER that, in deterministic mode, it calls `findArrivalTifs` and
 *      `extractDeterministicPerimeters` and pushes `arrival_time` and `perimeter`
 *      entries (:550, :612) — as `OutputItem`, the GUI/API DTO.
 *   3. `OutputItem` is never converted to a `ModelResult` and never saved. So the
 *      browser sees these products and the repository never does.
 *   4. `get-results-summary` / `get-results-data` (mcp/tools/execution.ts:140, :207)
 *      read `resultRepo.findByModelId` with no filtering. They are not at fault —
 *      they faithfully report rows that were never written.
 *
 * Franco chose rows over a new MCP tool: "a: results row". So the fix makes the
 * rows exist, and both MCP tools surface them unchanged.
 *
 * The domain already admits both types — `OutputType.Perimeter` and
 * `OutputType.ArrivalTime` have existed in ModelResult.ts:23-38 all along. Nothing
 * produced them.
 *
 * THE DISCRIMINATING ASSERTION is the third test: the saved perimeter row must
 * carry its GeoJSON. A row that merely exists with the right outputType would make
 * `get-results-data` report a perimeter an MCP caller still cannot use, which is
 * the same failure one layer further in.
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
import type { FireModelId, ModelResult } from '../../../domain/entities/index.js';

function makeEngine(overrides: Partial<IFireModelingEngine> = {}): IFireModelingEngine {
  return { getStatus: vi.fn(), getResults: vi.fn(), ...overrides } as unknown as IFireModelingEngine;
}

/** A minimal valid polygon feature, the shape `DeterministicPerimeter.geojson` carries. */
function polygonFeature(lon: number) {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'Polygon' as const,
      coordinates: [[[lon, 60], [lon + 0.1, 60], [lon + 0.1, 60.1], [lon, 60.1], [lon, 60]]],
    },
  };
}

describe('#536 — derived perimeter and arrival-time products are persisted as result rows', () => {
  let simDir: string;

  beforeEach(() => {
    resetModelResultsService();
    vi.clearAllMocks();
    simDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomad-536-rows-'));
    // simDir is derived as path.dirname(resolveResultFilePath(filePath)).
    mockResolveResultFilePath.mockImplementation(() => path.join(simDir, 'out.tif'));

    // ArrivalTifInfo, exactly as ArrivalTimeTileGenerator.ts:63-72 defines it.
    mockFindArrivalTifs.mockReturnValue({
      filePath: path.join(simDir, '000_000001_172_arrival.tif'),
      offsetDay: 170,
      endJulian: 173,
      julianDays: [170, 171, 172],
    });

    // DeterministicExtractionResult, as ArrivalTimeExtractor.ts:33-49 defines it.
    // Note `julianDay`, not `day` — GeneratedPerimeter uses `day` and is a
    // different type from a different producer.
    mockExtractDeterministicPerimeters.mockResolvedValue({
      success: true,
      value: {
        perimeters: [
          { julianDay: 170, date: '2025-06-19', geojson: polygonFeature(-114) },
          { julianDay: 171, date: '2025-06-20', geojson: polygonFeature(-114.2) },
        ],
        totalGrids: 2,
        successCount: 2,
      },
    });

    mockResultRepo.findByModelId.mockResolvedValue([]);
    mockResultRepo.save.mockResolvedValue(undefined);

    fs.writeFileSync(
      path.join(simDir, 'output-config.json'),
      JSON.stringify({
        outputMode: 'deterministic',
        timeRange: { start: '2025-06-19T18:00:00Z', end: '2025-06-22T18:00:00Z' },
      }),
      'utf-8',
    );
  });

  afterEach(() => {
    fs.rmSync(simDir, { recursive: true, force: true });
  });

  async function runGetResults() {
    const engine = makeEngine({
      getStatus: vi.fn().mockResolvedValue({
        state: 'completed',
        progress: 100,
        startedAt: new Date('2025-06-19T18:00:00Z'),
        completedAt: new Date('2025-06-19T18:05:00Z'),
        updatedAt: new Date('2025-06-19T18:05:00Z'),
      }),
      getResults: vi.fn().mockResolvedValue([
        {
          id: 'r-1',
          fireModelId: 'model-1' as FireModelId,
          outputType: 'probability',
          format: 'geotiff',
          metadata: { filePath: 'sim/out.tif' },
          getDisplayName: () => 'Burn Probability',
        },
      ]),
    });

    const svc = getModelResultsService(engine);
    const res = await svc.getResults('model-1' as FireModelId, 'Name', 'firestarr');
    if (!res.success) throw new Error('expected getResults to succeed');
    return res.value;
  }

  /** Every row handed to resultRepo.save across the call. */
  function savedRows(): ModelResult[] {
    return mockResultRepo.save.mock.calls.map((c) => c[0] as ModelResult);
  }

  it('saves one perimeter row per derived perimeter', async () => {
    await runGetResults();

    const perimeterRows = savedRows().filter((r) => r.outputType === 'perimeter');

    expect(perimeterRows).toHaveLength(2);
    expect(perimeterRows.every((r) => r.format === 'geojson')).toBe(true);
    expect(perimeterRows.map((r) => r.metadata.julianDay).sort()).toEqual([170, 171]);
  });

  it('saves an arrival_time row carrying the arrival raster file path', async () => {
    await runGetResults();

    const arrivalRows = savedRows().filter((r) => r.outputType === 'arrival_time');

    expect(arrivalRows).toHaveLength(1);
    expect(arrivalRows[0].format).toBe('geotiff');
    // Condition 4: a row must not point at nothing. findArrivalTifs gives an
    // absolute path to the highest-Julian-day file.
    expect(arrivalRows[0].metadata.filePath).toContain('000_000001_172_arrival.tif');
  });

  it('THE DISCRIMINATOR: a saved perimeter row carries its GeoJSON geometry', async () => {
    await runGetResults();

    const perimeterRows = savedRows().filter((r) => r.outputType === 'perimeter');
    const first = perimeterRows.find((r) => r.metadata.julianDay === 170);

    expect(first, 'a row for julian day 170 should have been saved').toBeDefined();
    // An MCP caller reads rows through get-results-data, which returns
    // `metadata` verbatim. A perimeter whose geometry is not in the row is a
    // perimeter MCP still cannot use.
    const geojson = first!.metadata.geojson as { geometry?: { type?: string } } | undefined;
    expect(geojson?.geometry?.type).toBe('Polygon');
  });

  it('is idempotent: rows already in the repository are not written again', async () => {
    // Second read of the same model — the rows now exist.
    mockResultRepo.findByModelId.mockResolvedValue([
      {
        id: 'perimeter-170-model-1',
        fireModelId: 'model-1' as FireModelId,
        outputType: 'perimeter',
        format: 'geojson',
        metadata: { julianDay: 170, geojson: polygonFeature(-114) },
        getDisplayName: () => 'Fire Perimeter',
      },
      {
        id: 'perimeter-171-model-1',
        fireModelId: 'model-1' as FireModelId,
        outputType: 'perimeter',
        format: 'geojson',
        metadata: { julianDay: 171, geojson: polygonFeature(-114.2) },
        getDisplayName: () => 'Fire Perimeter',
      },
      {
        id: 'arrival-time-model-1',
        fireModelId: 'model-1' as FireModelId,
        outputType: 'arrival_time',
        format: 'geotiff',
        metadata: { filePath: path.join(simDir, '000_000001_172_arrival.tif') },
        getDisplayName: () => 'Arrival Time',
      },
      {
        id: 'r-1',
        fireModelId: 'model-1' as FireModelId,
        outputType: 'probability',
        format: 'geotiff',
        metadata: { filePath: 'sim/out.tif' },
        getDisplayName: () => 'Burn Probability',
      },
    ]);

    await runGetResults();

    const rewritten = savedRows().filter(
      (r) => r.outputType === 'perimeter' || r.outputType === 'arrival_time',
    );
    expect(rewritten).toHaveLength(0);
  });

  it('does not regress the GUI: the deterministic outputs still carry their derived urls, names and colors', async () => {
    const value = await runGetResults();

    const perimeters = value.outputs.filter((o) => o.type === 'perimeter');
    expect(perimeters).toHaveLength(2);

    // These come from the derivation block, not from the row->OutputItem map.
    // Persisting rows must not cause `hasPerimeters` to short-circuit derivation
    // and hand the GUI /results/:id/preview instead.
    const day170 = perimeters.find((o) => (o.metadata as { day?: number }).day === 170);
    expect(day170, 'a derived output for julian day 170 should be present').toBeDefined();
    expect(day170!.previewUrl).toBe('/api/v1/models/model-1/perimeters?day=170');
    expect(day170!.name).toBe('Fire Boundary - 2025-06-19');
    expect((day170!.metadata as { color?: string }).color).toBeDefined();

    const arrival = value.outputs.find((o) => o.type === 'arrival_time');
    expect(arrival, 'the derived arrival_time output should be present').toBeDefined();
    expect(arrival!.previewUrl).toBe('/api/v1/models/model-1/arrival-tile/{z}/{x}/{y}.png');
  });
});
