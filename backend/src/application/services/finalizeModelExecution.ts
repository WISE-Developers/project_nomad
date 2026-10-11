/**
 * Resolves a model run's job and model records from the engine's final status (#432).
 *
 * This existed inline, twice, in models.ts — once for POST /models/run and once
 * for POST /models/:id/execute — and both copies had the same hole:
 *
 *     if (status.state === 'completed') { ... }
 *     else if (status.state === 'failed') { ... }
 *     // no else
 *
 * `ExecutionStatus` declares SIX states. If `execute()` returned without
 * throwing and `getStatus()` reported any of the four non-terminal ones, then
 * neither branch ran: the job was never completed and never failed, the
 * detached async callback simply ended, and the model record never advanced
 * either, because both saves lived inside those same two branches.
 *
 * What the operator sees is the processing window spinning forever. The SSE
 * route polls until the job reports terminal, and it never does. Nothing
 * clears it short of a server restart, which sweeps it up through
 * `markRunningAsFailed()` and calls it "Server restarted while job was
 * running" — a message that describes the restart rather than the failure.
 *
 * A spinner that never resolves is worse than an error. It tells the operator
 * to keep waiting for something that is not coming.
 *
 * Extracted to one place rather than fixed twice: two copies of a decision
 * this important is how the second copy gets missed.
 */

import type { ExecutionStatus } from '../interfaces/IFireModelingEngine.js';

export interface FinalizeDeps {
  readonly failJob: (reason: string) => Promise<void>;
  readonly completeJob: () => Promise<void>;
  readonly markModelCompleted: () => Promise<void>;
  readonly markModelFailed: () => Promise<void>;
  /** Results are harvested eagerly; failure here must not strand the job. */
  readonly harvestResults: () => Promise<void>;
  readonly warn: (message: string) => void;
}

/**
 * Every state resolves the job — exactly one of completeJob or failJob is
 * always called. That invariant is the fix, and it is asserted directly in
 * the tests rather than inferred from the branches.
 */
export async function finalizeModelExecution(
  status: ExecutionStatus,
  deps: FinalizeDeps,
): Promise<void> {
  if (status.state === 'completed') {
    await deps.completeJob();
    await deps.markModelCompleted();

    // Harvesting is a convenience — results can still be lazy-loaded on first
    // read. It must never leave a completed run looking unfinished, so it is
    // deliberately after the job is resolved and its failure is swallowed.
    try {
      await deps.harvestResults();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.warn(`Failed to harvest results: ${message}`);
    }
    return;
  }

  if (status.state === 'failed') {
    await deps.failJob(status.error ?? 'Execution failed');
    await deps.markModelFailed();
    return;
  }

  // The hole this function exists to close.
  //
  // An engine that returns from execute() while still reporting a
  // non-terminal state has not finished — it has stopped without saying so.
  // Treating that as a failure is correct AND it is the fail-fast choice:
  // the alternative is a job that hangs until the server restarts.
  //
  // The state is named in the message because "Execution failed" would send
  // someone looking at FireSTARR's log for an error that is not there. The
  // defect is that the engine stopped reporting, not that the fire model was
  // wrong.
  await deps.failJob(
    `Execution ended while the engine still reported '${status.state}'. ` +
      `The run stopped without reaching a final state, so no results were produced. ` +
      `This is an engine or orchestration fault rather than a problem with the model inputs.`,
  );
  await deps.markModelFailed();
}
