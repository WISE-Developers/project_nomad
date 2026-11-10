/**
 * A model that is executing reports `ModelStatus.Running` (#514).
 *
 * Nothing in the codebase assigned `Running`. A model went Queued -> Completed, so a run of
 * several minutes displayed as Queued for its whole duration and was indistinguishable from
 * one that had not started.
 *
 * TWO TESTS, DELIBERATELY DIFFERENT IN KIND, because one alone is not enough here.
 *
 * 1. BEHAVIOURAL, on `POST /models/:id/execute`: assert the SEQUENCE of statuses written,
 *    not the final one. A test that checks the terminal state passes whether or not this is
 *    fixed — the issue says so explicitly — and "observe it mid-execution" is unreliable
 *    with a floating async IIFE. The order of writes is the same fact, observable without
 *    timing games: `['running', 'completed']` rather than `['completed']`.
 *
 * 2. STRUCTURAL, over the whole class: every production site that marks the JOB running must
 *    also mark the MODEL running. There are three such files and only one of them is
 *    exercised by test 1, so without this a fix to the reported path would leave the others
 *    broken — which is the documented failure mode in this repo, and already happened on
 *    #513 where two call sites were wrong and only one was reported. This guard also fails
 *    when a FOURTH execution path is added, which no behavioural test can do.
 *
 * The structural test mirrors the house pattern used by `noPerRequestServer` (#480) and
 * carries its own control, because a scan that silently finds no files would otherwise pass.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const { initializeSpy, findById, save, savedStatuses } = vi.hoisted(() => {
  const savedStatuses: string[] = [];
  return {
    initializeSpy: vi.fn(async (_m: unknown, _o: unknown): Promise<void> => undefined),
    findById: vi.fn(),
    // Records the status of every model handed to save(), in call order. This is the
    // instrument: the route writes Running via save(model.withStatus(Running)).
    save: vi.fn(async (m: unknown) => {
      savedStatuses.push((m as { status: string }).status);
      return m;
    }),
    savedStatuses,
  };
});

vi.mock('../../../../infrastructure/engines/index.js', () => ({
  EngineType: { FireSTARR: 'firestarr' },
  getEngine: vi.fn(() => ({
    initialize: initializeSpy,
    execute: vi.fn(async () => undefined),
    // `state`, not `status`. finalizeModelExecution reads `status.state`
    // (finalizeModelExecution.ts:51), so a mock returning `{ status: 'completed' }` falls
    // through to the #432 non-terminal branch and the run reports FAILED. The sibling
    // executeOptions test has that shape and never notices, because it only asserts the
    // arguments to initialize().
    getStatus: vi.fn(async () => ({ state: 'completed' })),
    getResults: vi.fn(async () => []),
    getWorkingDirectory: vi.fn(() => null),
    cleanup: vi.fn(async () => undefined),
  })),
  getWorkspaceAwareEngine: vi.fn(() => ({
    initialize: initializeSpy,
    execute: vi.fn(async () => undefined),
  })),
}));

vi.mock('../../../../infrastructure/database/index.js', () => ({
  getModelRepository: vi.fn(() => ({
    findById,
    save,
    find: vi.fn(),
    updateStatus: vi.fn(async () => undefined),
    getConfigJson: vi.fn(async () => null),
    saveConfigJson: vi.fn(async () => undefined),
    getResults: vi.fn(async () => []),
    delete: vi.fn(async () => undefined),
  })),
  getResultRepository: vi.fn(() => ({
    save: vi.fn(async () => undefined),
    findByModelId: vi.fn(async () => []),
    deleteByModelId: vi.fn(async () => 0),
  })),
  getJobRepository: vi.fn(() => ({ deleteByModelId: vi.fn(async () => 0) })),
}));

vi.mock('../../../../infrastructure/services/JobQueue.js', () => ({
  getJobQueue: vi.fn(() => ({
    enqueue: vi.fn(async () => ({ success: true, value: { id: 'job-514', toJSON: () => ({}) } })),
    updateStatus: vi.fn(async () => ({ success: true })),
    complete: vi.fn(async () => ({ success: true })),
    fail: vi.fn(async () => ({ success: true })),
  })),
}));

import modelsRouter from '../models.js';
import { errorHandler } from '../../../middleware/errorHandler.js';
import {
  FireModel,
  createFireModelId,
  ModelStatus,
  EngineType,
} from '../../../../domain/entities/index.js';
import { serveOnce } from '../../../../test/sharedServer.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', modelsRouter);
  app.use(errorHandler);
  return app;
}

const api = serveOnce(buildApp);
const MODEL_ID = 'model-514';

function draftModel() {
  return new FireModel({
    id: createFireModelId(MODEL_ID),
    name: 'Running Status Test',
    engineType: EngineType.FireSTARR,
    status: ModelStatus.Draft,
    createdAt: new Date('2026-06-15T00:00:00Z'),
    updatedAt: new Date('2026-06-15T00:00:00Z'),
    userId: 'test-user',
  });
}

function validBody() {
  return {
    ignition: { type: 'point', coordinates: [-114.3, 62.5] },
    timeRange: { start: '2026-06-15T14:00:00Z', end: '2026-06-15T20:00:00Z' },
    weather: { source: 'firestarr_csv' },
    timezone: 'America/Edmonton',
  };
}

describe('#514 an executing model reports Running', () => {
  beforeEach(() => {
    savedStatuses.length = 0;
    findById.mockReset();
    findById.mockResolvedValue(draftModel());
  });

  it('writes running BEFORE completed on POST /models/:id/execute', async () => {
    await request(api()).post(`/api/v1/models/${MODEL_ID}/execute`).send(validBody());

    // The run finishes in a floating async IIFE, so wait for the terminal write.
    await vi.waitFor(
      () => {
        expect(
          savedStatuses,
          'no terminal status was ever written — the execution never ran, so this ' +
            'test can say nothing about the order and a green result would be vacuous',
        ).toContain(ModelStatus.Completed);
      },
      { timeout: 2000 },
    );

    // The whole sequence, not just the presence of Running. The route already writes
    // Queued when it accepts the request, so the complete lifecycle is
    // queued -> running -> completed; asserting the full order pins that Running lands
    // between them rather than merely appearing somewhere.
    expect(savedStatuses).toEqual([
      ModelStatus.Queued,
      ModelStatus.Running,
      ModelStatus.Completed,
    ]);
  });

  it('control: the recorder observes writes at all, so an empty sequence cannot pass', async () => {
    await request(api()).post(`/api/v1/models/${MODEL_ID}/execute`).send(validBody());
    await vi.waitFor(() => expect(savedStatuses.length).toBeGreaterThan(0), { timeout: 2000 });
  });
});

/**
 * Structural guard over the whole class. Enumerates production files that mark the job
 * running and requires each to mark the model running too.
 */
describe('#514 every execution path that marks the job running marks the model running', () => {
  const SRC = join(__dirname, '..', '..', '..', '..');

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === '__tests__' || entry === 'node_modules') continue;
        walk(full, out);
      } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
        out.push(full);
      }
    }
    return out;
  }

  /**
   * A model-status WRITE, not a mention. The first version of this guard asked whether the
   * file contained the string `ModelStatus.Running` at all, and was wrong in both
   * directions: it passed `mcp/tools/execution.ts`, which only COMPARES against Running,
   * and it flagged the whole job layer, which has no model concept to write.
   */
  // `[^;]` rather than `[^)]` on purpose. The first version used `[^)]*`, which cannot span
  // a nested call — `updateStatus(createFireModelId(modelId), ModelStatus.Running)` contains
  // an inner `)` — so it reported a real write as missing. Bounding on the statement
  // terminator instead spans arguments without running past the call.
  const WRITES_MODEL_RUNNING = /(?:withStatus|updateStatus)\([^;]*ModelStatus\.Running/g;
  // WRITES on this side too, for the same reason. Counting bare `JobStatus.Running`
  // mentions conflated a write with a comparison: `mcp/tools/execution.ts:115` is
  // `case JobStatus.Running:`, so that file reported 2 job marks against 1 model write and
  // the guard failed on correct code. Measured, not assumed — models.ts 2 writes,
  // mcp/tools/execution.ts 1.
  const MARKS_JOB_RUNNING = /updateStatus\([^;]*JobStatus\.Running/g;

  const count = (src: string, re: RegExp) => (src.match(re) ?? []).length;

  it('has no execution path that sets the job running without the model', () => {
    const all = walk(SRC).map((f) => ({ f, src: readFileSync(f, 'utf8') }));

    // The class is files that know about BOTH concepts. A file that marks the job running
    // and never mentions ModelStatus is the job layer — it has no model to write, and that
    // is a principled exclusion rather than an allowlist of names to maintain.
    const executionPaths = all.filter(
      ({ src }) => src.includes('JobStatus.Running') && src.includes('ModelStatus'),
    );

    // CONTROL: a scan that finds nothing would pass the assertion below vacuously.
    expect(
      executionPaths.length,
      'no production file marks a job running AND knows about ModelStatus — the scan is ' +
        'broken, not the code',
    ).toBeGreaterThanOrEqual(2);

    // COUNTED, not merely present — and this is the whole point of the guard.
    //
    // The first version asked whether each file contained a Running write at all. It PASSED
    // a mutation test: `models.ts` holds TWO execution paths, so deleting the write from one
    // of them left the other's write in the same file and the file still matched. A guard
    // that cannot fail on the defect it exists for is worse than no guard, because the green
    // tick is evidence of nothing.
    //
    // Comparing counts makes it path-granular: two job-running marks require two model
    // Running writes. Verified by mutation — reverting one path makes this fail.
    const offenders = executionPaths
      .filter(({ src }) => count(src, WRITES_MODEL_RUNNING) < count(src, MARKS_JOB_RUNNING))
      .map(
        ({ f, src }) =>
          `${f.replace(SRC, 'src')} (${count(src, MARKS_JOB_RUNNING)} job-running mark(s), ` +
          `${count(src, WRITES_MODEL_RUNNING)} model-Running write(s))`,
      );

    expect(
      offenders,
      'these files start a run without recording that the model is running (#514)',
    ).toEqual([]);
  });
});
