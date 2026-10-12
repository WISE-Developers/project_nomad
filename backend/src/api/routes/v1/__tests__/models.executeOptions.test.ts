/**
 * POST /models/:id/execute — the ExecutionOptions it actually hands the engine.
 *
 * Issue #435. `POST /models/run` derives outputMode from `modelMode`
 * (models.ts:177); this endpoint derives it from `body.outputMode`
 * (models.ts:676, :691) and never reads `modelMode` at all. A client asking for
 * a deterministic run on an existing model gets a probabilistic one, and the
 * response reports success.
 *
 * WHY THESE TESTS GO THROUGH THE REAL ROUTER: `src/api/__tests__/modelMode.test.ts`
 * reimplements the route's validation and derivation inside the test file — its
 * own comments say "Constants mirrored from models.ts route" and "Simulate
 * outputMode derivation logic". It asserts against a local `deriveOutputMode()`
 * it defines itself, so it is green and would remain green if models.ts were
 * deleted. A test that exercises a replica of the code cannot detect a defect in
 * the code.
 *
 * And no test in this repo asserts the ARGUMENT passed to engine.initialize —
 * models.engineWiring.characterization.test.ts mocks it as a bare no-op and
 * targets its toHaveBeenCalledWith at getWorkingDirectory. So the option object's
 * shape has never been observed on either HTTP path.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// ─── The retained spy: the instrument this file depends on ──────
const { initializeSpy, findById, save } = vi.hoisted(() => ({
  // Typed parameters — see the note in execution.parity.test.ts. A zero-arg
  // spy signature makes mock.calls[0][1] a compile error that the green suite
  // cannot show you.
  initializeSpy: vi.fn(async (_model: unknown, _options: unknown): Promise<void> => undefined),
  findById: vi.fn(),
  save: vi.fn(async (m: unknown) => m),
}));

vi.mock('../../../../infrastructure/engines/index.js', () => ({
  EngineType: { FireSTARR: 'firestarr' },
  getEngine: vi.fn(() => ({
    initialize: initializeSpy,
    execute: vi.fn(async () => undefined),
    getStatus: vi.fn(async () => ({ status: 'completed' })),
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
    enqueue: vi.fn(async () => ({ success: true, value: { id: 'job-435', toJSON: () => ({}) } })),
    updateStatus: vi.fn(async () => ({ success: true })),
    complete: vi.fn(async () => ({ success: true })),
    fail: vi.fn(async () => ({ success: true })),
  })),
}));

import modelsRouter from '../models.js';
import { errorHandler } from '../../../middleware/errorHandler.js';
import { FireModel, createFireModelId, ModelStatus, EngineType } from '../../../../domain/entities/index.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', modelsRouter);
  app.use(errorHandler);
  return app;
}

const MODEL_ID = 'model-435';

function draftModel() {
  return new FireModel({
    id: createFireModelId(MODEL_ID),
    name: 'Execute Options Test',
    engineType: EngineType.FireSTARR,
    status: ModelStatus.Draft,
    createdAt: new Date('2026-06-15T00:00:00Z'),
    updatedAt: new Date('2026-06-15T00:00:00Z'),
    userId: 'test-user',
  });
}

function validBody(extra: Record<string, unknown> = {}) {
  return {
    ignition: { type: 'point', coordinates: [-114.3, 62.5] },
    timeRange: { start: '2026-06-15T14:00:00Z', end: '2026-06-15T20:00:00Z' },
    weather: { source: 'firestarr_csv' },
    timezone: 'America/Edmonton',
    ...extra,
  };
}

/** initialize() is called from a floating async IIFE, so wait for it. */
async function optionsPassedToEngine(): Promise<Record<string, unknown>> {
  await vi.waitFor(
    () => {
      expect(
        initializeSpy,
        'engine.initialize was never called — this test can say nothing about ' +
          'its arguments, and a green result here would be vacuous',
      ).toHaveBeenCalled();
    },
    { timeout: 2000 },
  );
  return initializeSpy.mock.calls[0][1] as unknown as Record<string, unknown>;
}

describe('POST /models/:id/execute — ExecutionOptions handed to the engine', () => {
  beforeEach(() => {
    initializeSpy.mockClear();
    save.mockClear();
    findById.mockReset();
    findById.mockResolvedValue(draftModel());
  });

  describe('the control: the instrument itself', () => {
    it('observes the argument at all, and the spy is retained', async () => {
      await request(buildApp())
        .post(`/api/v1/models/${MODEL_ID}/execute`)
        .send(validBody())
        .expect(202);

      const options = await optionsPassedToEngine();
      // If this is ever empty, every assertion below is vacuous rather than wrong.
      expect(Object.keys(options).length).toBeGreaterThan(0);
      expect(options).toHaveProperty('timezone', 'America/Edmonton');
    });
  });

  describe('issue #435 — modelMode is honoured, not silently dropped', () => {
    it('runs deterministic when asked for deterministic via modelMode', async () => {
      await request(buildApp())
        .post(`/api/v1/models/${MODEL_ID}/execute`)
        .send(validBody({ modelMode: 'deterministic' }))
        .expect(202);

      expect((await optionsPassedToEngine()).outputMode).toBe('deterministic');
    });

    it('does not report success for a run it silently changed the mode of', async () => {
      // The defect's real cost: the caller is told the deterministic run they
      // asked for is underway. A refusal would be recoverable; a confident wrong
      // answer is not.
      const res = await request(buildApp())
        .post(`/api/v1/models/${MODEL_ID}/execute`)
        .send(validBody({ modelMode: 'deterministic' }));

      const options = await optionsPassedToEngine();
      const honoured = options.outputMode === 'deterministic';
      expect(
        honoured || res.status >= 400,
        `the endpoint returned ${res.status} while running outputMode=` +
          `${String(options.outputMode)} for a modelMode=deterministic request`,
      ).toBe(true);
    });
  });

  describe('parity: the same derivation as POST /models/run', () => {
    /**
     * DECLARED WEAK — this assertion CANNOT FAIL under the defect, and it passed
     * on its first run for the wrong reason.
     *
     * `modelMode: 'probabilistic'` expects `outputMode: 'probabilistic'`. But the
     * defective code ignores `modelMode` and falls through to 'probabilistic' as
     * its default, so the correct implementation and the broken one produce the
     * identical result. Green here means "the default happens to match", not
     * "the derivation works".
     *
     * Kept, with this note, rather than deleted: the probabilistic path still
     * needs to keep working after the fix, so it is a regression guard. It is
     * NOT a parity check and must not be counted as one — the deterministic case
     * above is the only assertion in this describe block that can distinguish
     * fixed from broken.
     *
     * (Caught by re-reading my own first green. The untaken path and the correct
     * path print identically — including in the test that was written to tell
     * them apart.)
     */
    it('keeps the probabilistic path working (regression guard, cannot detect #435)', async () => {
      await request(buildApp())
        .post(`/api/v1/models/${MODEL_ID}/execute`)
        .send(validBody({ modelMode: 'probabilistic' }))
        .expect(202);

      expect((await optionsPassedToEngine()).outputMode).toBe('probabilistic');
    });

    it('still accepts the legacy outputMode field', async () => {
      // Parity must not be achieved by breaking the field that currently works.
      await request(buildApp())
        .post(`/api/v1/models/${MODEL_ID}/execute`)
        .send(validBody({ outputMode: 'deterministic' }))
        .expect(202);

      expect((await optionsPassedToEngine()).outputMode).toBe('deterministic');
    });
  });
});
