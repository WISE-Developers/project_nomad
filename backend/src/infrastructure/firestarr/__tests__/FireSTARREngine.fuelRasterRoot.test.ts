/**
 * #282: `--raster-root` must follow the fuel SOURCE, not the installation.
 *
 * WHY THIS TEST EXISTS, AND IT IS THE SHARPEST THING IN THE FUEL WORK. FireSTARR is not
 * handed a fuel file. It takes `--raster-root`, a DIRECTORY, and selects its own grid
 * inside it. So a WCS-sourced run could fetch a coverage, check every pixel against the
 * canonical table, reproject it into the run's UTM zone, record "CFS FBP WCS coverage" as
 * its provenance — and the engine would still be pointed at the locally installed tiles,
 * so the fire would burn through local fuel while every artefact of the run said otherwise.
 *
 * That was not hypothetical. It was the state of the wiring until this branch existed,
 * and it PASSED everything: the WCS path ran, all its guards held, and the only thing
 * wrong was the single flag that decides what the fire actually reads. It was found by
 * asking D7's fourth question — was the resulting grid the one the ENGINE consumed —
 * rather than only whether the path ran.
 *
 * Both directions are asserted. A local run must keep the installed root, because
 * overriding it unconditionally would break every deployment in the field — and a suite
 * that only checked the override would pass on exactly that code.
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
} from '../../../domain/entities/index.js';
import { TimeRange } from '../../../domain/value-objects/index.js';
import type { ExecutionOptions } from '../../../application/interfaces/IFireModelingEngine.js';
import type { IContainerExecutor, ContainerRunOptions } from '../../../application/interfaces/IContainerExecutor.js';
import type { IInputGenerator, InputGenerationResult } from '../../../application/interfaces/IInputGenerator.js';
import type { IOutputParser, ParsedOutput } from '../../../application/interfaces/IOutputParser.js';
import type { FireSTARRParams } from '../types.js';
import { Result } from '../../../application/common/index.js';

function capturingExecutor(captured: string[][]): IContainerExecutor {
  return {
    run: vi.fn(),
    runStream: vi.fn().mockImplementation(async (options: ContainerRunOptions) => {
      captured.push([...options.command]);
      return Result.ok({ exitCode: 0, stdout: '', stderr: '', durationMs: 1 });
    }),
    isAvailable: vi.fn().mockResolvedValue(true),
    isServiceAvailable: vi.fn().mockResolvedValue(true),
  } as unknown as IContainerExecutor;
}

function mockParser(): IOutputParser<ParsedOutput[]> {
  return {
    parse: vi.fn().mockResolvedValue(Result.ok([])),
    parseLog: vi.fn().mockResolvedValue({ success: true, durationSeconds: 1 }),
  } as unknown as IOutputParser<ParsedOutput[]>;
}

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

describe('FireSTARREngine — --raster-root follows the fuel source (#282)', () => {
  let tempDir: string;
  let workingDir: string;
  let installedRoot: string;
  let captured: string[][];

  const ignition = new SpatialGeometry({
    type: GeometryType.Point,
    coordinates: [-115.7, 60.82],
  });

  const weather = [
    {
      datetime: new Date(Date.UTC(2026, 6, 1, 19, 0, 0)),
      temperature: 22,
      humidity: 35,
      windSpeed: 12,
      windDirection: 230,
      precipitation: 0,
      ffmc: 88,
      dmc: 35,
      dc: 280,
    },
  ];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'fuel-raster-root-'));
    workingDir = join(tempDir, 'sims', 'raster-root-model');
    installedRoot = join(tempDir, 'generated', 'grid', '100m');
    await mkdir(workingDir, { recursive: true });
    await mkdir(installedRoot, { recursive: true });
    captured = [];
    // Binary mode keeps the paths host-side, so the assertion is about the CHOICE of
    // root rather than about Docker path mapping.
    process.env.FIRESTARR_EXECUTION_MODE = 'binary';
    process.env.FIRESTARR_BINARY_PATH = '/usr/local/bin/firestarr';
  });

  afterEach(async () => {
    delete process.env.FIRESTARR_EXECUTION_MODE;
    delete process.env.FIRESTARR_BINARY_PATH;
    await rm(tempDir, { recursive: true, force: true });
  });

  function engineFor(extra: Partial<InputGenerationResult>): FireSTARREngine {
    const generator = {
      generate: vi.fn().mockResolvedValue(
        Result.ok({
          workingDir,
          weatherFile: join(workingDir, 'weather.csv'),
          configFiles: [],
          ...extra,
        } as InputGenerationResult)
      ),
      cleanup: vi.fn(),
      getGridRoot: () => installedRoot,
      getContainerGridRoot: () => '/appl/data/generated/grid/100m',
    } as unknown as IInputGenerator<FireSTARRParams>;

    return new FireSTARREngine(capturingExecutor(captured), generator, mockParser());
  }

  function options(): ExecutionOptions {
    return {
      ignitionGeometry: ignition,
      timeRange: new TimeRange(new Date('2026-07-01T19:00:00Z'), new Date('2026-07-04T19:00:00Z')),
      timezone: 'America/Edmonton',
      weatherData: weather,
    } as unknown as ExecutionOptions;
  }

  function model(): FireModel {
    return new FireModel({
      id: createFireModelId('raster-root-model'),
      name: 'raster root',
      engineType: EngineType.FireSTARR,
      status: ModelStatus.Queued,
      userId: 'test-user',
    } as never);
  }

  it('uses the run-supplied fuel raster root when the run sourced its own fuel', async () => {
    const perRun = join(workingDir, 'fuelgrid');
    const engine = engineFor({ fuelRasterRoot: perRun });
    const m = model();
    await engine.initialize(m, options());
    await engine.execute(m.id);

    expect(captured.length, 'the engine never ran, so this would assert nothing').toBeGreaterThan(0);
    expect(flagValue(captured[0], '--raster-root')).toBe(perRun);
    expect(flagValue(captured[0], '--raster-root')).not.toBe(installedRoot);
  });

  it('CONTROL: a local run still gets the INSTALLED root, unchanged', async () => {
    const engine = engineFor({});
    const m = model();
    await engine.initialize(m, options());
    await engine.execute(m.id);

    expect(captured.length, 'the engine never ran, so this would assert nothing').toBeGreaterThan(0);
    expect(flagValue(captured[0], '--raster-root')).toBe(installedRoot);
  });
});
