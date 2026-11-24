---------------------------- MODULE JobLifecycle ----------------------------
(***************************************************************************)
(* One model run in the Project Nomad backend: the `jobs` row and the      *)
(* `fire_models` row it belongs to, the background task that drives them,  *)
(* the FireSTARR container, a user cancel (DELETE /api/v1/jobs/:id), and a  *)
(* server restart.                                                         *)
(*                                                                         *)
(* Each action is ONE awaited step in the code: a repository write, an      *)
(* engine call, or a synchronous block between two awaits. TLC tries every  *)
(* order in which they can interleave. The comment on each action names the *)
(* code it stands for.                                                     *)
(*                                                                         *)
(* Path picks the execution entry point:                                   *)
(*   "run"     POST /models/run            backend/src/api/routes/v1/models.ts *)
(*   "execute" POST /models/:id/execute    backend/src/api/routes/v1/models.ts *)
(*   "mcp"     MCP execute_model tool      backend/src/mcp/tools/execution.ts  *)
(*                                                                         *)
(* Left out: the legacy ModelExecutionService (non-FireSTARR engines),     *)
(* database write failures, progress/result fields, more than one run, and *)
(* more than one restart or cancel. See .claude/skills/verify-job-lifecycle. *)
(***************************************************************************)
CONSTANT Path

ASSUME Path \in {"run", "execute", "mcp"}

VARIABLES
  jobSt,          \* jobs.status, or "none" before JobQueue.enqueue saves it
  modelSt,        \* fire_models.status
  pc,             \* where the background execution task is; "dead" = killed by a crash
  res,            \* what the engine returned to the background task: "none", "ok", "err"
  container,      \* the FireSTARR container: "none", "running", "exitedOk", "exitedErr"
  aborted,        \* the run's AbortSignal (runRegistry) has fired
  stopped,        \* runRegistry: a cancel confirmed the engine is stopped
  cancel,         \* the DELETE /jobs/:id handler (cancelRun)
  crashed,        \* the backend process has died once
  recovered,      \* JobQueue.initialize (startup recovery) has run since the crash
  swept,          \* startup has killed leftover nomad-run-* containers since the crash
  bootFailed,     \* startup could not confirm the sweep and exited; the server never listens
  firstFinal,     \* history: the first final status the job reached, or "none"
  killedByCancel  \* history: a cancel's kill stopped a running container

vars == <<jobSt, modelSt, pc, res, container, aborted, stopped, cancel,
          crashed, recovered, swept, bootFailed, firstFinal, killedByCancel>>

Active   == {"pending", "running"}
Terminal == {"completed", "failed", "cancelled"}   \* Job.isTerminalStatus

\* cancel states while the handler is still working on the request
CancelBusy == {"checked", "killing", "confirming", "killed", "jobCancelled"}

Init ==
  /\ jobSt = "none"
  /\ modelSt = "draft"
  /\ pc = IF Path = "mcp" THEN "engineInit" ELSE "saveQueued"
  /\ res = "none"
  /\ container = "none"
  /\ aborted = FALSE
  /\ stopped = FALSE
  /\ cancel = "idle"
  /\ crashed = FALSE
  /\ recovered = FALSE
  /\ swept = FALSE
  /\ bootFailed = FALSE
  /\ firstFinal = "none"
  /\ killedByCancel = FALSE

Go(from, to) == pc = from /\ pc' = to

\* Write jobs.status, and remember the first final status it ever had.
SetJob(st) ==
  /\ jobSt' = st
  /\ firstFinal' = IF firstFinal = "none" /\ st \in Terminal THEN st ELSE firstFinal

\* KnexJobRepository.updateIfActive: UPDATE jobs ... WHERE id = ? AND status IN ('pending','running').
\* Every JobQueue write goes through it, so a final status is never overwritten.
GuardedJob(st) == IF jobSt \in Active THEN SetJob(st) ELSE UNCHANGED <<jobSt, firstFinal>>

\* KnexModelRepository.updateStatusUnlessCancelled: ... WHERE id = ? AND status <> 'cancelled'.
\* The background task writes the model only through it.
GuardedModel(st) == modelSt' = IF modelSt = "cancelled" THEN modelSt ELSE st

Untouched == UNCHANGED <<container, aborted, stopped, cancel, crashed, recovered, swept, bootFailed, killedByCancel>>

(* ---------------- the background execution task ---------------- *)

\* models.ts: modelRepo.save(model) with status Queued (both HTTP paths, before the job exists).
SaveModelQueued ==
  /\ Go("saveQueued", "enqueue")
  /\ modelSt' = "queued"
  /\ UNCHANGED <<jobSt, firstFinal, res>> /\ Untouched

\* JobQueue.enqueue: repo.save(new Job{status: Pending}); then runRegistry.register(jobId),
\* synchronously, before the next await.
EnqueueJob ==
  /\ Go("enqueue", IF Path = "execute" THEN "engineInit" ELSE "jobRunning")
  /\ SetJob("pending")
  /\ UNCHANGED <<modelSt, res>> /\ Untouched

\* engine.initialize(...). /run calls it after marking the job and model running,
\* /execute before, MCP before the job exists.
EngineInitOk ==
  /\ Go("engineInit", CASE Path = "run"     -> "engine"
                        [] Path = "execute" -> "jobRunning"
                        [] Path = "mcp"     -> "enqueue")
  /\ UNCHANGED <<jobSt, firstFinal, modelSt, res>> /\ Untouched

\* initialize throws. HTTP paths go to their catch block; MCP returns engineFailed and writes nothing.
EngineInitThrows ==
  /\ Go("engineInit", IF Path = "mcp" THEN "done" ELSE "settle")
  /\ res' = "err"
  /\ UNCHANGED <<jobSt, firstFinal, modelSt>> /\ Untouched

\* await jobQueue.updateStatus(jobId, Running). Refused when the job is already final
\* (a cancel got there first), and then the task stops without writing anything else.
\* MCP awaits this too (finding F4).
MarkJobRunning ==
  /\ pc = "jobRunning"
  /\ IF jobSt \in Active
       THEN SetJob("running") /\ pc' = "modelRunning"
       ELSE UNCHANGED <<jobSt, firstFinal>> /\ pc' = "done"
  /\ UNCHANGED <<modelSt, res>> /\ Untouched

\* modelRepo.updateStatusUnlessCancelled(id, Running).
MarkModelRunning ==
  /\ Go("modelRunning", IF Path = "run" THEN "engineInit" ELSE "engine")
  /\ GuardedModel("running")
  /\ UNCHANGED <<jobSt, firstFinal, res>> /\ Untouched

\* engine.execute(modelId, { signal }) -> executor.runStream: checks signal.aborted and
\* spawns `docker compose run --name nomad-run-<modelId>` in the same synchronous block.
StartEngine ==
  /\ pc = "engine"
  /\ IF aborted
       THEN pc' = "settle" /\ res' = "err" /\ UNCHANGED container
       ELSE pc' = "waiting" /\ container' = "running" /\ UNCHANGED res
  /\ UNCHANGED <<jobSt, firstFinal, modelSt, aborted, stopped, cancel, crashed, recovered, swept, bootFailed, killedByCancel>>

\* The FireSTARR container ends on its own. It does not need the backend to be alive.
ContainerSucceeds ==
  /\ container = "running" /\ container' = "exitedOk"
  /\ UNCHANGED <<jobSt, firstFinal, modelSt, pc, res, aborted, stopped, cancel, crashed, recovered, swept, bootFailed, killedByCancel>>

ContainerFails ==
  /\ container = "running" /\ container' = "exitedErr"
  /\ UNCHANGED <<jobSt, firstFinal, modelSt, pc, res, aborted, stopped, cancel, crashed, recovered, swept, bootFailed, killedByCancel>>

\* runStream resolves when the compose CLI exits; execute + getStatus report the result.
EngineReturns ==
  /\ pc = "waiting" /\ container \in {"exitedOk", "exitedErr"}
  /\ pc' = "settle"
  /\ res' = IF container = "exitedOk" THEN "ok" ELSE "err"
  /\ UNCHANGED <<jobSt, firstFinal, modelSt>> /\ Untouched

\* await run.stoppedByCancel(): waits while a cancel is killing the engine. If the cancel
\* confirmed the kill, the task stops and leaves the job and model to the cancel.
\* Otherwise finalizeModelExecution (or the catch block) resolves the run.
Settle ==
  /\ pc = "settle"
  /\ cancel \notin {"killing", "confirming"}
  /\ pc' = IF stopped THEN "done" ELSE IF res = "ok" THEN "completeJob" ELSE "failJob"
  /\ UNCHANGED <<jobSt, firstFinal, modelSt, res>> /\ Untouched

\* JobQueue.complete / JobQueue.fail, both through updateIfActive. finalizeModelExecution
\* writes the model only when this job write was applied: if a cancel already took the
\* job, the model is the cancel's to write.
CompleteJob ==
  /\ pc = "completeJob"
  /\ pc' = IF jobSt \in Active THEN "modelCompleted" ELSE "done"
  /\ GuardedJob("completed")
  /\ UNCHANGED <<modelSt, res>> /\ Untouched

FailJob ==
  /\ pc = "failJob"
  /\ pc' = IF jobSt \in Active THEN "modelFailed" ELSE "done"
  /\ GuardedJob("failed")
  /\ UNCHANGED <<modelSt, res>> /\ Untouched

\* modelRepo.updateStatusUnlessCancelled(id, Completed | Failed).
MarkModelCompleted ==
  /\ Go("modelCompleted", "done")
  /\ GuardedModel("completed")
  /\ UNCHANGED <<jobSt, firstFinal, res>> /\ Untouched

MarkModelFailed ==
  /\ Go("modelFailed", "done")
  /\ GuardedModel("failed")
  /\ UNCHANGED <<jobSt, firstFinal, res>> /\ Untouched

(* ---------------- DELETE /api/v1/jobs/:id  ->  cancelRun ---------------- *)

CanServe == crashed => recovered
CancelVars == <<modelSt, pc, res, crashed, recovered, swept, bootFailed>>

\* cancelRun: jobQueue.getJob, job.canCancel().
CancelAccepted ==
  /\ cancel = "idle" /\ CanServe /\ jobSt \in Active
  /\ cancel' = "checked"
  /\ UNCHANGED <<jobSt, firstFinal, container, aborted, stopped, killedByCancel>> /\ UNCHANGED CancelVars

\* ...or 400: the job is already final.
CancelRejected ==
  /\ cancel = "idle" /\ CanServe /\ jobSt \in Terminal
  /\ cancel' = "rejected"
  /\ UNCHANGED <<jobSt, firstFinal, container, aborted, stopped, killedByCancel>> /\ UNCHANGED CancelVars

\* After the model lookup: runRegistry.get(jobId).abort() (no later spawn can start) and
\* engine.cancel(modelId) begins; run.cancelling is set in the same synchronous block.
CancelStartsKill ==
  /\ cancel = "checked"
  /\ cancel' = "killing"
  /\ aborted' = TRUE
  /\ UNCHANGED <<jobSt, firstFinal, container, stopped, killedByCancel>> /\ UNCHANGED CancelVars

\* DockerExecutor.cancel, first half: `docker kill nomad-run-<modelId>`. The container
\* dies, the compose CLI exits, and the run's runStream resolves - while cancelRun is
\* still waiting for the confirmation below.
ContainerKilled ==
  /\ cancel = "killing"
  /\ cancel' = "confirming"
  /\ container' = IF container = "running" THEN "exitedErr" ELSE container
  /\ killedByCancel' = (killedByCancel \/ container = "running")
  /\ UNCHANGED <<jobSt, firstFinal, aborted, stopped>> /\ UNCHANGED CancelVars

\* Second half: stopChildProcess, then `docker ps` shows nothing by that name. The run
\* is marked stopped (runRegistry), and the kill is no longer in flight.
KillConfirmed ==
  /\ cancel = "confirming"
  /\ cancel' = "killed"
  /\ stopped' = TRUE
  /\ UNCHANGED <<jobSt, firstFinal, container, aborted, killedByCancel>> /\ UNCHANGED CancelVars

\* ...or the kill cannot be confirmed (docker unreachable, container still listed), before
\* or after `docker kill` did anything: cancelRun throws an EngineError, the API answers
\* 500, and nothing is marked cancelled.
KillFails ==
  /\ cancel \in {"killing", "confirming"}
  /\ cancel' = "failedLoud"
  /\ UNCHANGED <<jobSt, firstFinal, container, aborted, stopped, killedByCancel>> /\ UNCHANGED CancelVars

\* jobQueue.cancel through updateIfActive. Refused (400) when the run reached a final
\* status on its own before the kill.
CancelJobWrite ==
  /\ cancel = "killed"
  /\ IF jobSt \in Active
       THEN SetJob("cancelled") /\ cancel' = "jobCancelled"
       ELSE UNCHANGED <<jobSt, firstFinal>> /\ cancel' = "conflict"
  /\ UNCHANGED <<container, aborted, stopped, killedByCancel>> /\ UNCHANGED CancelVars

\* modelRepo.updateStatus(modelId, Cancelled), then 200.
CancelModelWrite ==
  /\ cancel = "jobCancelled"
  /\ cancel' = "ok"
  /\ modelSt' = "cancelled"
  /\ UNCHANGED <<jobSt, firstFinal, pc, res, container, aborted, stopped, crashed, recovered, swept, bootFailed, killedByCancel>>

(* ---------------- server restart ---------------- *)

\* The node process dies with every in-flight async task. The container is a separate
\* process and may keep running.
ServerCrashes ==
  /\ ~crashed
  /\ crashed' = TRUE
  /\ pc' = IF pc = "done" THEN "done" ELSE "dead"
  /\ cancel' = IF cancel \in CancelBusy THEN "dead" ELSE cancel
  /\ UNCHANGED <<jobSt, firstFinal, modelSt, res, container, aborted, stopped, recovered, swept, bootFailed, killedByCancel>>

\* JobQueue.initialize, from initializeDatabaseLayer in backend/src/index.ts, before the
\* server listens:
\*   1. jobRepo.failInterrupted(): pending and running jobs -> failed.
\*   2. each model still queued or running, or still draft but with a job (MCP never
\*      writes queued), takes the outcome of its latest job:
\*      completed -> completed, cancelled -> cancelled, anything else or no job -> failed.
RecoveredModel(js) ==
  IF modelSt \in {"queued", "running"} \/ (modelSt = "draft" /\ js # "none")
    THEN CASE js = "completed" -> "completed"
           [] js = "cancelled" -> "cancelled"
           [] OTHER            -> "failed"
    ELSE modelSt

\* startupRecovery.ts, step 1, before anything else at boot: the executor's
\* killLeftovers() lists containers named nomad-run-* of this compose project, removes
\* them with `docker rm -f`, and lists again. Nothing may be left.
StartupSweep ==
  /\ crashed /\ ~swept /\ ~bootFailed
  /\ swept' = TRUE
  /\ container' = IF container = "running" THEN "exitedErr" ELSE container
  /\ UNCHANGED <<jobSt, firstFinal, modelSt, pc, res, aborted, stopped, cancel, crashed, recovered, bootFailed, killedByCancel>>

\* ...or the daemon cannot be asked, or a container is still listed: killLeftovers throws,
\* startServer logs it and exits 1. Recovery does not run and the server never listens.
StartupSweepFails ==
  /\ crashed /\ ~swept /\ ~bootFailed
  /\ bootFailed' = TRUE
  /\ UNCHANGED <<jobSt, firstFinal, modelSt, pc, res, container, aborted, stopped, cancel, crashed, recovered, swept, killedByCancel>>

\* Step 2, only after a confirmed sweep.
StartupRecovery ==
  /\ crashed /\ swept /\ ~recovered
  /\ recovered' = TRUE
  /\ LET js == IF jobSt \in Active THEN "failed" ELSE jobSt
     IN SetJob(js) /\ modelSt' = RecoveredModel(js)
  /\ UNCHANGED <<pc, res, container, aborted, stopped, cancel, crashed, swept, bootFailed, killedByCancel>>

(* ---------------- nothing left to do ---------------- *)

\* Nothing in the backend is still working on this run.
Quiet ==
  /\ pc \in {"done", "dead"}
  /\ cancel \notin CancelBusy
  /\ crashed => recovered

\* A failed boot is an end state too: the operator has to fix Docker and start again.
Finished == (Quiet \/ bootFailed) /\ UNCHANGED vars

Next ==
  \/ SaveModelQueued \/ EnqueueJob \/ EngineInitOk \/ EngineInitThrows
  \/ MarkJobRunning \/ MarkModelRunning \/ StartEngine
  \/ ContainerSucceeds \/ ContainerFails \/ EngineReturns \/ Settle
  \/ CompleteJob \/ MarkModelCompleted \/ FailJob \/ MarkModelFailed
  \/ CancelAccepted \/ CancelRejected \/ CancelStartsKill \/ ContainerKilled \/ KillConfirmed \/ KillFails
  \/ CancelJobWrite \/ CancelModelWrite
  \/ ServerCrashes \/ StartupSweep \/ StartupSweepFails \/ StartupRecovery
  \/ Finished

Spec == Init /\ [][Next]_vars

(* ---------------- the rules ---------------- *)

TypeOK ==
  /\ jobSt \in {"none"} \cup Active \cup Terminal
  /\ modelSt \in {"draft", "queued", "running", "completed", "failed", "cancelled"}
  /\ container \in {"none", "running", "exitedOk", "exitedErr"}
  /\ cancel \in {"idle", "rejected", "failedLoud", "conflict", "ok", "dead"} \cup CancelBusy

\* Once a job is completed, failed or cancelled, its status never changes.
FinalJobStaysFinal == firstFinal # "none" => jobSt = firstFinal

\* With no restart, a run nobody is working on any more has a final job.
FinishedRunHasFinalJob ==
  (Quiet /\ ~crashed /\ jobSt # "none") => jobSt \in Terminal

\* With no restart, a run nobody is working on any more has a final model.
FinishedRunHasFinalModel ==
  (Quiet /\ ~crashed) => modelSt \notin {"queued", "running"}

\* After startup recovery, no job still says running.
RestartFailsRunningJobs == recovered => jobSt # "running"

\* After startup recovery, no job still says pending (nothing will ever pick it up).
RestartLeavesNoPendingJob == recovered => jobSt # "pending"

\* After startup recovery, no model still says queued or running.
RestartLeavesNoActiveModel == recovered => modelSt \notin {"queued", "running"}

\* When a run is over, the job and the model agree on whether it succeeded.
JobAndModelAgreeOnSuccess ==
  (Quiet /\ jobSt # "none") => ((jobSt = "completed") <=> (modelSt = "completed"))

\* When a run is over, the job and the model agree on whether it was cancelled.
JobAndModelAgreeOnCancel ==
  (Quiet /\ jobSt # "none") => ((jobSt = "cancelled") <=> (modelSt = "cancelled"))

\* A cancelled job never has a FireSTARR container running for it.
CancelledRunHasNoEngine == jobSt = "cancelled" => container # "running"

\* Once the cancel API has answered 200, the job and the model both say cancelled.
AcceptedCancelEndsCancelled == cancel = "ok" => (jobSt = "cancelled" /\ modelSt = "cancelled")

\* When the cancel could not confirm the kill, the job is not marked cancelled.
FailedCancelLeavesJobAlone == cancel = "failedLoud" => jobSt # "cancelled"

\* Once the restarted server is up, no FireSTARR container from before the crash is running.
RestartLeavesNoEngine == recovered => container # "running"

\* A run whose container a cancel killed, with the kill confirmed, ends cancelled, not
\* failed. (When the kill lands but cannot be confirmed, the cancel fails loudly and the
\* job is not cancelled: FailedCancelLeavesJobAlone.)
KilledRunEndsCancelled ==
  (Quiet /\ ~crashed /\ killedByCancel /\ stopped) => (jobSt = "cancelled" /\ modelSt = "cancelled")

=============================================================================
