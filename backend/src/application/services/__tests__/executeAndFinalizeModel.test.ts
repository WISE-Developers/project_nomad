/**
 * Running a model must end in the state the ENGINE reports, not in whether
 * the promise happened to resolve.
 *
 * The MCP execution path (mcp/tools/execution.ts) was a third execution site,
 * missed when #432 was fixed at the two sites in models.ts. It does not hang
 * — then/catch covers both outcomes — but it is wrong in two ways that are
 * arguably worse than hanging:
 *
 *   engine.execute(modelId)
 *     .then(async () => {
 *       const results = await engine.getResults(modelId);   // harvest FIRST
 *       ...
 *       await jobQueue.complete(job.id);                    // complete AFTER
 *     })
 *     .catch(async (err) => { ...fail... });
 *
 * 1. getStatus() is never called at all. `execute()` resolving is treated as
 *    success, so a run that finished in a FAILED state without throwing is
 *    reported as completed — handing the caller empty results and no error.
 *    A hang at least says something is wrong.
 *
 * 2. Harvesting runs before the job is completed, so a getResults() throw
 *    (disk full, outputs missing) marks a SUCCESSFUL simulation as failed.
 *    That is the exact inversion finalizeModelExecution guards against by
 *    harvesting after the job is resolved.
 *
 * Found because Franco asked whether I had run models through the browser or
 * through MCP. I had checked two call sites, declared #432 fixed, and never
 * looked for a third.
 */

import { describe, it, expect, vi } from 'vitest';
import { executeAndFinalizeModel, type ExecuteDeps } from '../executeAndFinalizeModel.js';
import type { ExecutionStatus } from '../../interfaces/IFireModelingEngine.js';

const status = (state: ExecutionStatus['state'], error?: string) =>
  ({ state, error }) as ExecutionStatus;

function deps(over: Partial<ExecuteDeps> = {}): ExecuteDeps {
  return {
    execute: vi.fn(async () => undefined),
    getStatus: vi.fn(async () => status('completed')),
    completeJob: vi.fn(async () => undefined),
    failJob: vi.fn(async () => undefined),
    markModelCompleted: vi.fn(async () => undefined),
    markModelFailed: vi.fn(async () => undefined),
    harvestResults: vi.fn(async () => undefined),
    warn: vi.fn(),
    ...over,
  };
}

describe('executeAndFinalizeModel — the engine decides, not the promise', () => {
  it('completes when the engine reports completed', async () => {
    const d = deps();
    await executeAndFinalizeModel(d);

    expect(d.completeJob).toHaveBeenCalled();
    expect(d.failJob).not.toHaveBeenCalled();
  });

  it('FAILS when execute() resolves but the engine reports failed', async () => {
    // The defect: resolving was treated as success, so this was marked
    // completed and the caller got empty results with no error.
    const d = deps({ getStatus: vi.fn(async () => status('failed', 'Process exited with code 1')) });

    await executeAndFinalizeModel(d);

    expect(d.failJob).toHaveBeenCalledWith('Process exited with code 1');
    expect(d.completeJob).not.toHaveBeenCalled();
  });

  it('fails when execute() resolves while the engine is still non-terminal', async () => {
    const d = deps({ getStatus: vi.fn(async () => status('running')) });

    await executeAndFinalizeModel(d);

    expect(d.failJob).toHaveBeenCalled();
    expect(d.completeJob).not.toHaveBeenCalled();
  });

  it('fails when execute() throws', async () => {
    const d = deps({ execute: vi.fn(async () => { throw new Error('container died'); }) });

    await executeAndFinalizeModel(d);

    expect(d.failJob).toHaveBeenCalled();
    const reason = String((d.failJob as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? '');
    expect(reason).toContain('container died');
  });

  it('fails when getStatus() itself throws, rather than leaving the job open', async () => {
    const d = deps({ getStatus: vi.fn(async () => { throw new Error('status unavailable'); }) });

    await executeAndFinalizeModel(d);

    expect(d.failJob).toHaveBeenCalled();
  });
});

describe('executeAndFinalizeModel — harvesting must not invert the outcome', () => {
  it('still COMPLETES a successful run whose harvest throws', async () => {
    // The second defect: harvesting ran before completion, so a disk error
    // turned a good simulation into a reported failure.
    const d = deps({ harvestResults: vi.fn(async () => { throw new Error('disk full'); }) });

    await executeAndFinalizeModel(d);

    expect(d.completeJob).toHaveBeenCalled();
    expect(d.failJob).not.toHaveBeenCalled();
    expect(d.warn).toHaveBeenCalled();
  });

  it('does not harvest at all when the run failed', async () => {
    const d = deps({ getStatus: vi.fn(async () => status('failed', 'boom')) });

    await executeAndFinalizeModel(d);

    expect(d.harvestResults).not.toHaveBeenCalled();
  });
});
