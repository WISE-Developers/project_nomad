/**
 * DELETE /jobs/:id. Stops the engine, then records the job and the model as cancelled.
 *
 * The order is the point (verification/job-lifecycle, finding F1):
 *
 *   1. The job must still be pending or running, or the request is refused (400).
 *   2. The engine is killed, and the kill must be CONFIRMED: for FireSTARR that means
 *      the daemon reports no container left for this run. If it cannot be confirmed the
 *      cancel fails with a 500 and nothing is marked cancelled. A cancelled job with a
 *      container still burning CPU is the outcome this exists to prevent, so there is no
 *      fallback that records the cancel anyway.
 *   3. Only then is the job written cancelled, through JobQueue's guarded write. If the
 *      run finished on its own while the kill was in flight, that write is refused and
 *      the finished result stands.
 *   4. The model is written cancelled. The stopped run writes neither (runRegistry).
 */
import type { EngineType, Job, JobId } from '../../domain/entities/index.js';
import { ModelStatus } from '../../domain/entities/index.js';
import type { IFireModelingEngine } from '../interfaces/IFireModelingEngine.js';
import type { IJobQueue } from '../interfaces/IJobQueue.js';
import type { IModelRepository } from '../interfaces/IModelRepository.js';
import { EngineError, NotFoundError, ValidationError } from '../../domain/errors/index.js';
import type { RunRegistry } from './runRegistry.js';

export interface CancelRunDeps {
  readonly jobQueue: IJobQueue;
  readonly modelRepository: IModelRepository;
  readonly engineFor: (engineType: EngineType) => IFireModelingEngine;
  readonly runs: RunRegistry;
}

/** @throws NotFoundError, ValidationError (not cancellable), EngineError (kill not confirmed) */
export async function cancelRun(jobId: JobId, deps: CancelRunDeps): Promise<Job> {
  const found = await deps.jobQueue.getJob(jobId);
  if (!found.success) throw found.error;
  const job = found.value;

  if (!job.canCancel()) {
    throw new ValidationError(`Job cannot be cancelled - status is ${job.status}`, [
      { field: 'status', message: `Job is already ${job.status}` },
    ]);
  }

  const model = await deps.modelRepository.findById(job.modelId);
  if (!model) throw new NotFoundError('Model', job.modelId);
  const engine = deps.engineFor(model.engineType);
  const kill = () => engine.cancel(job.modelId);
  const run = deps.runs.get(jobId);

  try {
    // With a run in this process, stop() also fires its signal and makes it wait for
    // the kill. Without one, nothing here is driving the run, but a container from it
    // may still exist, so the kill and its confirmation still happen.
    await (run ? run.stop(kill) : kill());
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw EngineError.cancelFailed(
      model.engineType,
      `Could not stop the engine for job ${jobId}, so it was not cancelled: ${reason}`,
    );
  }

  const cancelled = await deps.jobQueue.cancel(jobId);
  if (!cancelled.success) throw cancelled.error;

  await deps.modelRepository.updateStatus(job.modelId, ModelStatus.Cancelled);
  return cancelled.value;
}
