/**
 * What the backend does at boot about runs the previous process left unfinished
 * (verification/job-lifecycle). Called from initializeDatabaseLayer in index.ts, before
 * the server listens, so no request or run is in flight.
 *
 *   1. Remove every engine container the dead process left running, and confirm none is
 *      left. Recovery is about to mark those runs failed; a container still running beside
 *      a failed job keeps burning CPU, can still write outputs, and blocks a re-run of the
 *      same model (its container name is taken).
 *   2. Only then fail the interrupted jobs and settle their models (JobQueue.initialize).
 *
 * If step 1 cannot be confirmed this throws, and startServer exits with the error. There is
 * deliberately no "start anyway": the server never serves beside containers it could not
 * stop.
 */
import type { IJobQueue } from '../interfaces/IJobQueue.js';

export interface StartupRecoveryDeps {
  /** IContainerExecutor.killLeftovers for the FireSTARR executor. */
  readonly killLeftoverEngines: () => Promise<string[]>;
  readonly jobQueue: Pick<IJobQueue, 'initialize'>;
  readonly log?: (message: string) => void;
}

export async function recoverAfterRestart(deps: StartupRecoveryDeps): Promise<void> {
  let removed: string[];
  try {
    removed = await deps.killLeftoverEngines();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Startup stopped: could not remove leftover engine containers from before the restart, ` +
        `so the server will not start beside them. ${reason}`,
    );
  }
  if (removed.length > 0) {
    deps.log?.(`Removed ${removed.length} leftover engine container(s): ${removed.join(', ')}`);
  }

  await deps.jobQueue.initialize();
}
