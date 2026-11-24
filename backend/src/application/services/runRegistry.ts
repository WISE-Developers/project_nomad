/**
 * In-process record of the runs this backend is driving, keyed by job ID, so that a
 * cancel (cancelRun) and the background run it stops can coordinate.
 *
 * A run's background task and DELETE /jobs/:id are separate async tasks with awaits in
 * between, so they interleave. Three things keep a cancel and a run from contradicting
 * each other (see verification/job-lifecycle):
 *
 *   - `signal` fires before the engine is killed, so no container can start after the
 *     kill has looked for one;
 *   - while a cancel is killing the engine, `stoppedByCancel()` waits for it, so the run
 *     cannot see its engine die and record a failure that races the cancel;
 *   - when the kill is confirmed, `stoppedByCancel()` is true and the run writes nothing
 *     more: the job and the model are the cancel's to write.
 *
 * Process-local by design. After a restart there is no run to coordinate with, and
 * startup recovery (JobQueue.initialize) settles whatever was in flight.
 */
import type { FireModelId, JobId } from '../../domain/entities/index.js';

export interface RunHandle {
  readonly signal: AbortSignal;
  /** Waits out a cancel that is killing the engine. True if a cancel stopped this run. */
  stoppedByCancel(): Promise<boolean>;
  /** Removes the run from the registry. Call when the background task ends. */
  release(): void;
}

/** What cancelRun drives. */
export interface CancellableRun {
  readonly modelId: FireModelId;
  /** Fires the signal and records the kill in flight; resolves to the kill's outcome. */
  stop(kill: () => Promise<void>): Promise<void>;
}

interface Entry {
  readonly modelId: FireModelId;
  readonly controller: AbortController;
  killing: Promise<void> | null;
  stopped: boolean;
}

export class RunRegistry {
  private readonly runs = new Map<string, Entry>();

  register(jobId: JobId, modelId: FireModelId): RunHandle {
    const entry: Entry = { modelId, controller: new AbortController(), killing: null, stopped: false };
    this.runs.set(jobId, entry);
    return {
      signal: entry.controller.signal,
      stoppedByCancel: async () => {
        while (entry.killing) {
          await entry.killing.catch(() => undefined);
        }
        return entry.stopped;
      },
      release: () => {
        if (this.runs.get(jobId) === entry) this.runs.delete(jobId);
      },
    };
  }

  get(jobId: JobId): CancellableRun | undefined {
    const entry = this.runs.get(jobId);
    if (!entry) return undefined;
    return {
      modelId: entry.modelId,
      stop: async (kill) => {
        // Abort first, in the same synchronous block that records the kill in flight:
        // from here on the run neither starts a container nor resolves itself.
        entry.controller.abort();
        const killing = kill();
        entry.killing = killing;
        try {
          await killing;
          entry.stopped = true;
        } finally {
          entry.killing = null;
        }
      },
    };
  }
}

let instance: RunRegistry | null = null;

export function getRunRegistry(): RunRegistry {
  if (!instance) instance = new RunRegistry();
  return instance;
}

export function resetRunRegistry(): void {
  instance = null;
}
