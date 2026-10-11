/**
 * A run that ends in a non-terminal state must still end the job (#432).
 *
 * models.ts handled the engine's post-execute status as:
 *
 *     if (status.state === 'completed') { ... }
 *     else if (status.state === 'failed') { ... }
 *     // no else
 *
 * IFireModelingEngine declares SIX states — queued, initializing, running,
 * processing, completed, failed. If execute() returned without throwing and
 * getStatus() reported any of the four non-terminal ones, neither branch ran.
 * The job was never completed and never failed, the detached async callback
 * simply ended, and the model record was never advanced either because both
 * modelRepo.save calls lived inside those same two branches.
 *
 * The visible result is the processing window spinning forever: the SSE route
 * polls until the job is terminal, and it never becomes terminal. Only a
 * server restart clears it, via markRunningAsFailed().
 *
 * Reported from the CIFFC demo on an over-size fire — "It seems to have
 * failed, but the processing window is spinning". Corroborated locally on
 * 2026-10-10, where fire_models.status sat at 'queued' for 14+ minutes while
 * the job had already moved pending -> running.
 *
 * A spinner that never resolves is worse than an error: it tells the operator
 * to keep waiting for something that will never arrive.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { finalizeModelExecution, type FinalizeDeps } from '../finalizeModelExecution.js';
import type { ExecutionStatus } from '../../interfaces/IFireModelingEngine.js';

let deps: FinalizeDeps;

beforeEach(() => {
  deps = {
    failJob: vi.fn(async () => undefined),
    completeJob: vi.fn(async () => undefined),
    markModelCompleted: vi.fn(async () => undefined),
    markModelFailed: vi.fn(async () => undefined),
    harvestResults: vi.fn(async () => undefined),
    warn: vi.fn(),
  };
});

const status = (state: ExecutionStatus['state'], error?: string) =>
  ({ state, error }) as ExecutionStatus;

describe('finalizeModelExecution — terminal states (#432)', () => {
  it('completes the job and the model when the engine completed', async () => {
    await finalizeModelExecution(status('completed'), deps);

    expect(deps.completeJob).toHaveBeenCalled();
    expect(deps.markModelCompleted).toHaveBeenCalled();
    expect(deps.failJob).not.toHaveBeenCalled();
  });

  it('fails the job and the model when the engine failed', async () => {
    await finalizeModelExecution(status('failed', 'Process exited with code 1'), deps);

    expect(deps.failJob).toHaveBeenCalledWith('Process exited with code 1');
    expect(deps.markModelFailed).toHaveBeenCalled();
  });
});

describe('finalizeModelExecution — the non-terminal states that hung (#432)', () => {
  const stranded: ExecutionStatus['state'][] = ['queued', 'initializing', 'running', 'processing'];

  for (const state of stranded) {
    it(`fails the job when the engine finished in '${state}' rather than leaving it hanging`, async () => {
      await finalizeModelExecution(status(state), deps);

      expect(deps.failJob).toHaveBeenCalled();
      expect(deps.markModelFailed).toHaveBeenCalled();
    });

    it(`names '${state}' in the failure, so the cause is not guesswork`, async () => {
      await finalizeModelExecution(status(state), deps);

      const reason = String((deps.failJob as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? '');
      expect(reason).toContain(state);
    });
  }

  it('never leaves a job in neither state', async () => {
    // The whole defect in one assertion: every state must resolve the job.
    const all: ExecutionStatus['state'][] = [
      'queued', 'initializing', 'running', 'processing', 'completed', 'failed',
    ];

    for (const state of all) {
      const fresh: FinalizeDeps = {
        failJob: vi.fn(async () => undefined),
        completeJob: vi.fn(async () => undefined),
        markModelCompleted: vi.fn(async () => undefined),
        markModelFailed: vi.fn(async () => undefined),
        harvestResults: vi.fn(async () => undefined),
        warn: vi.fn(),
      };

      await finalizeModelExecution(status(state), fresh);

      const resolved =
        (fresh.completeJob as ReturnType<typeof vi.fn>).mock.calls.length +
        (fresh.failJob as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(resolved, `state '${state}' left the job unresolved`).toBe(1);
    }
  });
});

describe('finalizeModelExecution — harvesting must not strand the job (#432)', () => {
  it('still completes when harvesting results throws', async () => {
    // FinalizeDeps is readonly, so build a fresh one rather than mutating it.
    const failing: FinalizeDeps = {
      ...deps,
      harvestResults: vi.fn(async () => {
        throw new Error('disk full');
      }),
    };

    await finalizeModelExecution(status('completed'), failing);

    expect(failing.completeJob).toHaveBeenCalled();
    expect(failing.warn).toHaveBeenCalled();
  });
});
