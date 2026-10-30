/**
 * #482 half 1 — the model's STORED time range is the authoritative source.
 *
 * `fix/482-no-invented-start-date` removed the invented start date and left
 * `readModelStartDate(simDir)` as the single source. That was correct and
 * incomplete: it reads the sim directory, and the sim directory's
 * `output-config.json` was only ever a side effect of a run. Reading harder from
 * disk cannot recover a value that was never written there.
 *
 * So the range now lives ON THE MODEL (migration 009, `FireModel.timeRange`),
 * and this file asserts the service prefers it over anything on disk.
 *
 * THE DISCRIMINATOR, because "a date appeared" is satisfiable by the old path:
 * in every test below the config on disk either has NO `timeRange` or has a
 * DIFFERENT one, so only a service reading the model can produce the expected
 * answer. A test where disk and model agreed could not tell the two apart.
 *
 * TWO THINGS THIS HARNESS TAUGHT ME, recorded because both are the shape where
 * a test passes while measuring nothing:
 *
 *   1. `inputs` is set to `undefined` unless an ignition or weather file is
 *      found (ModelResultsService.ts:421). So asserting
 *      `inputs?.modelStartDate` toBeUndefined passes trivially on an empty sim
 *      dir. Every test here writes a `weather.csv` so `inputs` SURVIVES, and
 *      the control below proves the field is reachable.
 *
 *   2. The arrival branch is gated on `outputMode === 'deterministic'`, read
 *      from the config file on disk and from nowhere else. A sim directory
 *      with no config at all therefore cannot reach that branch whatever the
 *      model knows — mode is a second value with the same root cause as the
 *      time range, and fixing it is NOT in this change.
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
import { TimeRange } from '../../../domain/value-objects/index.js';

function makeEngine(overrides: Partial<IFireModelingEngine> = {}): IFireModelingEngine {
  return { getStatus: vi.fn(), getResults: vi.fn(), ...overrides } as unknown as IFireModelingEngine;
}

interface ArrivalMetadata {
  startDate?: unknown;
  startJulian?: number;
  offsetDay?: number;
}

/** The range stored on the model — a 2023 reconstruction starting on day 170. */
const MODEL_RANGE = new TimeRange(
  new Date('2023-06-19T12:00:00.000Z'),
  new Date('2023-06-22T12:00:00.000Z'),
);
const MODEL_START_ISO = '2023-06-19T12:00:00.000Z';

/** The legacy config shape: three keys, no timeRange. Verified on real sim dirs. */
const LEGACY_CONFIG = {
  confidenceInterval: 1,
  outputMode: 'deterministic',
  smoothPerimeter: false,
};

describe('#482 — the model’s stored time range outranks the sim directory', () => {
  let simDir: string;

  beforeEach(() => {
    resetModelResultsService();
    vi.clearAllMocks();
    simDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomad-482-model-range-'));
    mockResolveResultFilePath.mockImplementation(() => path.join(simDir, 'out.tif'));
    mockFindArrivalTifs.mockReturnValue({
      offsetDay: 170,
      endJulian: 173,
      julianDays: [170, 171, 172],
    });
    mockExtractDeterministicPerimeters.mockResolvedValue({ success: false });
    mockResultRepo.findByModelId.mockResolvedValue([]);
    mockResultRepo.save.mockResolvedValue(undefined);
    // Keeps `inputs` alive — see note 1 in the header. Without a weather or
    // ignition file the whole inputs object is discarded and every assertion
    // about modelStartDate would pass against nothing.
    fs.writeFileSync(path.join(simDir, 'weather.csv'), 'Scenario,Date,Temp\nS1,2023-06-19 13:00,21.5\n');
  });

  afterEach(() => {
    fs.rmSync(simDir, { recursive: true, force: true });
  });

  async function runGetResults(modelTimeRange?: TimeRange) {
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
    const res = await svc.getResults(
      'model-1' as FireModelId,
      'Name',
      'firestarr',
      undefined,
      null,
      modelTimeRange,
    );
    if (!res.success) throw new Error('expected getResults to succeed');
    return res.value;
  }

  function arrivalMetadata(value: { outputs: Array<{ type: string; metadata?: unknown }> }) {
    const arrival = value.outputs.find((o) => o.type === 'arrival_time');
    expect(arrival, 'an arrival_time output should be present').toBeDefined();
    return (arrival!.metadata ?? {}) as ArrivalMetadata;
  }

  describe('the controls', () => {
    it('inputs is REACHABLE in this harness — the positive control', async () => {
      // The instrument check. `inputs` exists here, so a later
      // `toBeUndefined()` on modelStartDate is a statement about the start
      // date and not about the whole object having been discarded.
      fs.writeFileSync(path.join(simDir, 'output-config.json'), JSON.stringify(LEGACY_CONFIG));

      const value = await runGetResults(MODEL_RANGE);

      expect(value.inputs).toBeDefined();
      expect(value.inputs?.weatherCsvPath).toContain('weather.csv');
    });

    it('with NO stored range and a legacy config, the start date stays unknown', async () => {
      // The negative control, now meaningful because of the test above. This
      // is the state `fix/482-no-invented-start-date` established and must not
      // regress: no range anywhere means no start date, not today.
      fs.writeFileSync(path.join(simDir, 'output-config.json'), JSON.stringify(LEGACY_CONFIG));

      const value = await runGetResults(undefined);

      expect(value.inputs).toBeDefined();
      expect(value.inputs?.modelStartDate).toBeUndefined();
      expect(arrivalMetadata(value).startDate).toBeUndefined();
    });
  });

  it('reports the stored range when the legacy config records none', async () => {
    // The case the whole change exists for: a real legacy config — three keys,
    // no timeRange — beside a model that now knows its own range.
    fs.writeFileSync(path.join(simDir, 'output-config.json'), JSON.stringify(LEGACY_CONFIG));

    const value = await runGetResults(MODEL_RANGE);

    expect(value.inputs?.modelStartDate).toBe(MODEL_START_ISO);

    const meta = arrivalMetadata(value);
    expect(meta.startDate).toBe(MODEL_START_ISO);
    // The Julian window is anchored to the stored start, not to the file count.
    expect(meta.startJulian).toBe(170);
  });

  it('THE DISCRIMINATOR: the model wins when the config on disk disagrees', async () => {
    // Disk says 2019 day 1; the model says 2023 day 170. Only a service reading
    // the model can answer 2023 — which is what "read from there instead of off
    // disk" has to mean to be worth anything.
    fs.writeFileSync(
      path.join(simDir, 'output-config.json'),
      JSON.stringify({
        ...LEGACY_CONFIG,
        timeRange: { start: '2019-01-01T00:00:00.000Z', end: '2019-01-04T00:00:00.000Z' },
      }),
    );

    const value = await runGetResults(MODEL_RANGE);

    expect(value.inputs?.modelStartDate).toBe(MODEL_START_ISO);
    expect(arrivalMetadata(value).startDate).toBe(MODEL_START_ISO);
    expect(arrivalMetadata(value).startJulian).toBe(170);
  });

  it('still falls back to the sim directory for models with no stored range', async () => {
    // Half 1 does not orphan the legacy runs. A model with no stored range
    // keeps reading whatever the sim directory records.
    fs.writeFileSync(
      path.join(simDir, 'output-config.json'),
      JSON.stringify({
        ...LEGACY_CONFIG,
        timeRange: { start: '2019-01-01T00:00:00.000Z', end: '2019-01-04T00:00:00.000Z' },
      }),
    );

    const value = await runGetResults(undefined);

    expect(value.inputs?.modelStartDate).toBe('2019-01-01T00:00:00.000Z');
    expect(arrivalMetadata(value).startDate).toBe('2019-01-01T00:00:00.000Z');
  });

  describe('#482 half 2 — day-precision recovery, labelled as derived', () => {
    // The recovered value is REPORTED SEPARATELY from modelStartDate and never
    // merged into it. modelStartDate is documented as an ISO-8601 instant, and
    // the only instant a calendar date could become is midnight — the new
    // invented value this issue exists to prevent. A caller must be able to
    // tell a recorded start from a recovered day, so they are different fields.

    it('recovers the day from the engine’s own sizes filenames when nothing recorded it', async () => {
      fs.writeFileSync(path.join(simDir, 'output-config.json'), JSON.stringify(LEGACY_CONFIG));
      fs.writeFileSync(path.join(simDir, 'sizes_171_2023-06-20.csv'), 'Scenario,Size\n1,10\n');
      fs.writeFileSync(path.join(simDir, 'sizes_170_2023-06-19.csv'), 'Scenario,Size\n1,10\n');

      const value = await runGetResults(undefined);

      // Still no start date: an unknown instant stays unknown.
      expect(value.inputs?.modelStartDate).toBeUndefined();
      // But the day is recovered, labelled, and traceable.
      expect(value.inputs?.derivedModelDate).toEqual({
        date: '2023-06-19',
        julianDay: 170,
        precision: 'day',
        source: 'sizes_170_2023-06-19.csv',
      });
    });

    it('does NOT report a derived day when the model records a real range', async () => {
      // A derived value must never stand beside, or appear to compete with, a
      // recorded one. Recorded wins and the derived field is absent entirely.
      fs.writeFileSync(path.join(simDir, 'output-config.json'), JSON.stringify(LEGACY_CONFIG));
      fs.writeFileSync(path.join(simDir, 'sizes_170_2023-06-19.csv'), 'Scenario,Size\n1,10\n');

      const value = await runGetResults(MODEL_RANGE);

      expect(value.inputs?.modelStartDate).toBe(MODEL_START_ISO);
      expect(value.inputs?.derivedModelDate).toBeUndefined();
    });

    it('does NOT report a derived day when the sim directory records a range', async () => {
      fs.writeFileSync(
        path.join(simDir, 'output-config.json'),
        JSON.stringify({
          ...LEGACY_CONFIG,
          timeRange: { start: '2019-01-01T00:00:00.000Z', end: '2019-01-04T00:00:00.000Z' },
        }),
      );
      fs.writeFileSync(path.join(simDir, 'sizes_170_2023-06-19.csv'), 'Scenario,Size\n1,10\n');

      const value = await runGetResults(undefined);

      expect(value.inputs?.modelStartDate).toBe('2019-01-01T00:00:00.000Z');
      expect(value.inputs?.derivedModelDate).toBeUndefined();
    });

    it('reports nothing at all when there are no sizes files either', async () => {
      // The unrecoverable case, and it stays unrecoverable. No field appears.
      fs.writeFileSync(path.join(simDir, 'output-config.json'), JSON.stringify(LEGACY_CONFIG));

      const value = await runGetResults(undefined);

      expect(value.inputs?.modelStartDate).toBeUndefined();
      expect(value.inputs?.derivedModelDate).toBeUndefined();
    });

    it('does not feed the derived day into the arrival-time start date', async () => {
      // THE LIMIT, asserted. arrivalTimeSymbolization computes a sub-day
      // ignition fraction from startDate, so handing it a day-precision value
      // would smuggle midnight in as the ignition time. startDate stays
      // undefined; the recovered day is reported only in its own labelled field.
      fs.writeFileSync(path.join(simDir, 'output-config.json'), JSON.stringify(LEGACY_CONFIG));
      fs.writeFileSync(path.join(simDir, 'sizes_170_2023-06-19.csv'), 'Scenario,Size\n1,10\n');

      const value = await runGetResults(undefined);

      expect(value.inputs?.derivedModelDate?.date).toBe('2023-06-19');
      expect(arrivalMetadata(value).startDate).toBeUndefined();
    });
  });

  it('a malformed config does not defeat the stored range', async () => {
    // The old branch did `JSON.parse(readFileSync(...))` with no guard inside a
    // try that swallowed the throw and dropped the entire arrival output. A
    // model that KNOWS its range must not lose it to an unparseable file.
    //
    // Mode detection reads the same file, so with the config unreadable the
    // arrival branch is unreachable and only `inputs.modelStartDate` is
    // assertable here. That limit is the subject of note 2 in the header.
    fs.writeFileSync(path.join(simDir, 'output-config.json'), '{ this is not json');

    const value = await runGetResults(MODEL_RANGE);

    expect(value.inputs?.modelStartDate).toBe(MODEL_START_ISO);
  });
});
