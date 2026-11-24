/**
 * Runs a model and resolves its job from the state the ENGINE reports.
 *
 * The MCP execution path decided the outcome from whether `execute()`
 * resolved:
 *
 *     engine.execute(modelId)
 *       .then(async () => {
 *         const results = await engine.getResults(modelId);   // harvest FIRST
 *         ...
 *         await jobQueue.complete(job.id);                    // complete AFTER
 *       })
 *       .catch(async (err) => { ...fail... });
 *
 * Two faults, and both are worse than the hang #432 fixed, because each one
 * reports an outcome that is confidently wrong rather than absent:
 *
 * 1. `getStatus()` was never called. A run that finished in a FAILED state
 *    without throwing was reported as completed, handing the caller empty
 *    results and no error. A hang at least signals that something is wrong.
 *
 * 2. Harvesting ran before the job was completed, so a `getResults()` throw —
 *    disk full, outputs missing — marked a SUCCESSFUL simulation as failed.
 *
 * Both now route through finalizeModelExecution, so all execution paths share
 * one decision instead of each holding a different wrong one. That sharing is
 * the actual fix: this site was missed when #432 was repaired at the two
 * sites in models.ts, and a third copy is exactly how that happens.
 */

import { finalizeModelExecution, type FinalizeDeps } from './finalizeModelExecution.js';
import type { ExecutionStatus } from '../interfaces/IFireModelingEngine.js';

export interface ExecuteDeps extends FinalizeDeps {
  readonly execute: () => Promise<void>;
  readonly getStatus: () => Promise<ExecutionStatus>;
  /**
   * RunHandle.stoppedByCancel. Checked once the engine has returned or thrown: when a
   * cancel stopped the run, nothing is written, because the job and the model are the
   * cancel's to write. Omitted means no cancel can reach this run.
   */
  readonly stoppedByCancel?: () => Promise<boolean>;
}

/**
 * Never rejects. Callers start this in the background, so a throw here would
 * be an unhandled rejection and the job would be left open — the failure mode
 * being closed. Every path ends with the job resolved.
 */
export async function executeAndFinalizeModel(deps: ExecuteDeps): Promise<void> {
  let status: ExecutionStatus;

  const stopped = () => deps.stoppedByCancel?.() ?? Promise.resolve(false);

  try {
    await deps.execute();
    // Asking the engine is the point. Resolving only means the call returned.
    status = await deps.getStatus();
  } catch (error) {
    try {
      if (await stopped()) return;
      const message = error instanceof Error ? error.message : String(error);
      if (await deps.failJob(message)) await deps.markModelFailed();
    } catch (writeError) {
      const message = writeError instanceof Error ? writeError.message : String(writeError);
      deps.warn(`Failed to record execution outcome: ${message}`);
    }
    return;
  }

  try {
    if (await stopped()) return;
    await finalizeModelExecution(status, deps);
  } catch (error) {
    // Resolving the job is the one thing that must happen. If the repository
    // write itself fails there is nothing further to try, but it must not
    // escape as an unhandled rejection from a detached call.
    const message = error instanceof Error ? error.message : String(error);
    deps.warn(`Failed to record execution outcome: ${message}`);
  }
}
