/**
 * FireSTARREngine — a MultiPolygon ignition becomes the perimeter (refs #294
 * slice 3).
 *
 * buildParams's perimeter rule previously only recognized Polygon and
 * LineString. A merged, multi-member ignition is a MultiPolygon and must
 * become `params.perimeter` exactly as a single polygon would — otherwise a
 * merge silently loses its own perimeter raster.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdtemp, mkdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { FireSTARREngine } from '../FireSTARREngine.js';
import {
  FireModel,
  createFireModelId,
  EngineType,
  ModelStatus,
  GeometryType,
  SpatialGeometry,
  type MultiPolygonCoordinates,
} from '../../../domain/entities/index.js';
import { TimeRange } from '../../../domain/value-objects/index.js';
import type { ExecutionOptions } from '../../../application/interfaces/IFireModelingEngine.js';
import type { IContainerExecutor } from '../../../application/interfaces/IContainerExecutor.js';
import type { IInputGenerator, InputGenerationResult } from '../../../application/interfaces/IInputGenerator.js';
import type { IOutputParser, ParsedOutput } from '../../../application/interfaces/IOutputParser.js';
import type { FireSTARRParams } from '../types.js';
import { Result } from '../../../application/common/index.js';

function createMockExecutor(): IContainerExecutor {
  return {
    run: vi.fn(),
    runStream: vi.fn().mockResolvedValue(Result.ok({ exitCode: 0, stdout: '', stderr: '', durationMs: 1 })),
    isAvailable: vi.fn().mockResolvedValue(true),
    isServiceAvailable: vi.fn().mockResolvedValue(true),
  } as unknown as IContainerExecutor;
}

function createMockOutputParser(): IOutputParser<ParsedOutput[]> {
  return {
    parse: vi.fn().mockResolvedValue(Result.ok([])),
    parseLog: vi.fn().mockResolvedValue({ success: true, durationSeconds: 1 }),
  } as unknown as IOutputParser<ParsedOutput[]>;
}

const TWO_SQUARES: MultiPolygonCoordinates = [
  [[[-115.71, 60.81], [-115.70, 60.81], [-115.70, 60.82], [-115.71, 60.82], [-115.71, 60.81]]],
  [[[-115.61, 60.91], [-115.60, 60.91], [-115.60, 60.92], [-115.61, 60.92], [-115.61, 60.91]]],
];

describe('FireSTARREngine — buildParams perimeter rule accepts MultiPolygon', () => {
  let tempDir: string;
  let workingDir: string;
  let generatedParams: FireSTARRParams[];
  let engine: FireSTARREngine;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'firestarr-multipoly-perim-'));
    workingDir = join(tempDir, 'sims', 'multipoly-test-model');
    await mkdir(workingDir, { recursive: true });
    generatedParams = [];

    const mockInputGenerator = {
      generate: vi.fn().mockImplementation(async (_id: unknown, params: FireSTARRParams) => {
        generatedParams.push(params);
        return Result.ok({
          workingDir,
          weatherFile: join(workingDir, 'weather.csv'),
          configFiles: [],
        } as InputGenerationResult);
      }),
      cleanup: vi.fn(),
    } as unknown as IInputGenerator<FireSTARRParams>;

    engine = new FireSTARREngine(
      createMockExecutor(),
      mockInputGenerator,
      createMockOutputParser(),
    );

    process.env.FIRESTARR_EXECUTION_MODE = 'binary';
    process.env.FIRESTARR_BINARY_PATH = '/usr/local/bin/firestarr';
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    delete process.env.FIRESTARR_EXECUTION_MODE;
    delete process.env.FIRESTARR_BINARY_PATH;
  });

  it('sets params.perimeter to the MultiPolygon ignition, not undefined', async () => {
    const modelId = createFireModelId('multipoly-perim');
    const model = new FireModel({
      id: modelId,
      name: 'MultiPolygon perimeter test',
      engineType: EngineType.FireSTARR,
      status: ModelStatus.Queued,
      userId: 'test-user',
    });

    const ignition = new SpatialGeometry({
      type: GeometryType.MultiPolygon,
      coordinates: TWO_SQUARES,
    });

    const options: ExecutionOptions = {
      ignitionGeometry: ignition,
      timeRange: new TimeRange(
        new Date('2023-06-19T19:00:00Z'),
        new Date('2023-06-22T19:00:00Z'),
      ),
      timezone: 'America/Edmonton',
      weatherData: [{
        datetime: new Date('2023-06-19T19:00:00Z'),
        temperature: 22,
        humidity: 35,
        windSpeed: 12,
        windDirection: 230,
        precipitation: 0,
        ffmc: 88,
        dmc: 35,
        dc: 280,
      }],
      outputMode: 'deterministic',
    };

    await engine.initialize(model, options);

    expect(generatedParams).toHaveLength(1);
    expect(generatedParams[0].perimeter).toBeDefined();
    expect(generatedParams[0].perimeter?.type).toBe(GeometryType.MultiPolygon);
    // The lat/lon handed to FireSTARR come from the MultiPolygon's own
    // area-weighted centroid, not a guess or the first member alone.
    const [centroidLon, centroidLat] = ignition.getCentroid();
    expect(generatedParams[0].longitude).toBeCloseTo(centroidLon, 10);
    expect(generatedParams[0].latitude).toBeCloseTo(centroidLat, 10);
  });
});
