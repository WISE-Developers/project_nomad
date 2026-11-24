---
name: verify-job-lifecycle
description: Model-check the backend job and model lifecycle (pending, running, completed, failed, cancelled, cancel killing the FireSTARR container, and server restart including the startup sweep of leftover containers) with TLA+. Use when a change touches JobQueue, Job/FireModel status, the Knex job or model repository status writes, startup recovery (startupRecovery.ts, JobQueue.initialize, killLeftovers, backend/src/index.ts), cancelRun or runRegistry, engine/executor cancel or execute, finalizeModelExecution/executeAndFinalizeModel, the execution code in POST /models/run, POST /models/:id/execute, or the MCP execute-model tool, or DELETE /jobs/:id.
---

# Verify the job and model lifecycle

`verification/job-lifecycle/JobLifecycle.tla` is a TLA+ model of one model run: the `jobs` row, its `fire_models` row, the background task that drives them, the FireSTARR container, a user cancel, and one server restart. TLC tries every order in which those steps can interleave. Tests check the orders someone wrote down. This check covers all of them, within the bounds below.

## The rules

Each rule is an INVARIANT in the spec. The harm says what an operator sees when it breaks. All of them must pass.

| Rule | Plain sentence | Harm when broken |
| --- | --- | --- |
| `FinalJobStaysFinal` | Once a job is completed, failed or cancelled, its status never changes. | A cancel the API accepted is silently undone, or a finished run changes its story. |
| `FinishedRunHasFinalJob` | With no restart, when nothing is working on a run, its job is final. | The processing window spins forever (#432). |
| `FinishedRunHasFinalModel` | With no restart, when nothing is working on a run, its model is not queued or running. | The dashboard shows a run that will never finish. |
| `RestartFailsRunningJobs` | After startup recovery, no job says running. | Same as above, after a restart. |
| `RestartLeavesNoPendingJob` | After startup recovery, no job says pending. | Nothing ever picks a pending job up again, so it waits forever. |
| `RestartLeavesNoActiveModel` | After startup recovery, no model says queued or running. | The model shows queued/running forever, and `canExecute()` refuses to rerun it. |
| `JobAndModelAgreeOnSuccess` | When a run is over, the job and the model agree on whether it succeeded. | The UI or MCP reports the wrong outcome. |
| `JobAndModelAgreeOnCancel` | When a run is over, the job and the model agree on whether it was cancelled. | Same, for cancels. |
| `CancelledRunHasNoEngine` | A cancelled job never has a FireSTARR container running for it. | The operator sees "cancelled" while the container keeps burning CPU, and may start another run beside it. |
| `AcceptedCancelEndsCancelled` | Once the cancel API has answered 200, the job and the model both say cancelled. | A 200 that is not true. |
| `FailedCancelLeavesJobAlone` | When the cancel could not confirm the kill, the job is not marked cancelled. | A silent fallback: "cancelled" with nothing stopped. |
| `KilledRunEndsCancelled` | A run whose container a cancel killed, with the kill confirmed, ends cancelled, not failed. | The killed run races the cancel and records itself as an engine failure. |
| `RestartLeavesNoEngine` | Once the restarted server is up, no FireSTARR container from before the crash is running. | A container keeps burning CPU and writing outputs beside a job that says failed, and a re-run of the model fails because the container name is taken. |

`Path` selects the entry point: `run` (POST /models/run), `execute` (POST /models/:id/execute), or `mcp` (the MCP `execute-model` tool). `check.sh` checks every rule on every path, one TLC run each (39 runs).

A second, smaller spec, `verification/job-lifecycle/ComposeProject.tla`, models two deployments on one Docker daemon, each with `COMPOSE_PROJECT_NAME` set or unset. `check.sh` also checks its two rules (reported as path `compose`), for 41 checks in all:

| Rule | Plain sentence | Harm when broken |
| --- | --- | --- |
| `NoForeignKill` | A deployment's startup sweep never removes another deployment's container. | Restarting one deployment kills another's runs. |
| `UnsetNeverServes` | A deployment without `COMPOSE_PROJECT_NAME` never serves in Docker mode. | It labels and sweeps under a guessed name it shares with every other deployment that never set one. |

Its one assumption: deployments that set a name set different ones.

## When to use this

Run it when a change touches any file in the coverage record below. To see whether it does:

```sh
git diff --name-only 16c4fda -- backend/src/infrastructure/services/JobQueue.ts backend/src/domain/entities/Job.ts backend/src/domain/entities/FireModel.ts backend/src/infrastructure/database/knex/KnexJobRepository.ts backend/src/infrastructure/database/knex/KnexModelRepository.ts backend/src/index.ts backend/src/infrastructure/execution/composeProjectName.ts backend/src/application/services/startupRecovery.ts backend/src/application/services/cancelRun.ts backend/src/application/services/runRegistry.ts backend/src/application/services/finalizeModelExecution.ts backend/src/application/services/executeAndFinalizeModel.ts backend/src/infrastructure/firestarr/FireSTARREngine.ts backend/src/infrastructure/docker/DockerExecutor.ts backend/src/infrastructure/nativebinary/NativeBinaryExecutor.ts backend/src/api/routes/v1/models.ts backend/src/api/routes/v1/jobs.ts backend/src/mcp/tools/execution.ts
```

Any output means the verification needs a look. The command compares the working tree with the sync commit, so it also sees uncommitted edits. Also run the check when a change adds a new place that writes `jobs.status` or `fire_models.status`, or starts or stops an engine. Find those with `rg -n "jobQueue\.(enqueue|updateStatus|complete|fail|cancel)|ModelStatus\.(Queued|Running|Completed|Failed|Cancelled)|updateStatusUnlessCancelled|failInterrupted|killLeftovers|recoverAfterRestart|COMPOSE_PROJECT_NAME|composeProjectName|engine\.(execute|cancel)|runRegistry|getRunRegistry" backend/src`. If a hit is not in the coverage record, the model does not describe it yet.

## Run

```sh
verification/job-lifecycle/check.sh
```

The run takes about 30 seconds. The first run downloads `tla2tools.jar` v1.7.4 and, when no working `java` is on PATH, a Temurin 21.0.5+11 JRE into `~/.cache/project-nomad-tla`. Both downloads are checked against pinned sha256 sums. It needs the network once. Set `JAVA=/path/to/java` to use your own Java 11+. Set `OUT=dir` to keep the TLC output somewhere specific.

The script prints `path rule PASS|BREAK|ERROR` for each pair and compares the list with `verification/job-lifecycle/expected.txt`, which is all `PASS`:

- `OK: results match expected.txt`: every rule holds on every path.
- `DIFFERENT from expected.txt`: a `-... PASS` / `+... BREAK` line is a broken rule. Read its trace before you do anything else.
- `ERROR`: TLC did not finish, usually because of a parse or type error in the spec. Read `$OUT/<path>-<rule>/tlc.out`.

Each break's shortest counterexample is in `$OUT/<path>-<rule>/tlc.out`, as `State N: <ActionName ...>` blocks.

## Read a result

Read every result with the pstack `/statechart` skill (type `/pstack:statechart`). Give it `verification/job-lifecycle/JobLifecycle.tla`, a config with the `Path` you care about (`JobLifecycle.cfg` is `run`, so copy it and change `Path` for the others), and the view `verification/job-lifecycle/view.mjs`. It prints each broken rule's shortest path in plain words, such as "a user asks to cancel → the cancel stops new engine starts → the engine is killed → the kill is confirmed → the job is saved cancelled", and when rules hold it draws how a run moves between states. If `/statechart` cannot install its own TLC or Java, point it at the jar and the java binary that `check.sh` cached in `~/.cache/project-nomad-tla`.

## Real bug or modeling error?

A counterexample is a list of actions. Each action names the code it stands for in the comment above it in the `.tla` file. Before you report a break:

1. Walk the path through the real code, one action at a time, and check that each step is reachable in that order. Two steps can interleave only when an `await` separates them, or when they are on different async tasks. The tasks are the background IIFE in `models.ts` or MCP's `executeAndFinalizeModel`, the DELETE /jobs/:id handler (`cancelRun`), and the container itself.
2. Replay it against the real code. The tests below already run the real `JobQueue`, routes, and Knex repositories on an in-memory SQLite database built by the real migrations (`backend/src/test/migratedTestDb.ts`), with only the engine faked. Copy the closest one, hold a promise open to force the interleaving, and assert the status the path ends in. Run it with `cd backend && npx vitest run <file>`.
   - `backend/src/api/routes/v1/__tests__/jobs.cancel.test.ts`: whole runs through the routes, with cancel.
   - `backend/src/application/services/__tests__/cancelRun.test.ts`: cancel ordering and the registry.
   - `backend/src/infrastructure/services/__tests__/JobQueue.finalStatus.test.ts`: guarded job writes.
   - `backend/src/infrastructure/services/__tests__/JobQueue.recovery.test.ts`: startup recovery.
   - `backend/src/infrastructure/docker/__tests__/DockerExecutor.cancel.test.ts`: container kill, against a fake `docker` on PATH.
   - `backend/src/mcp/__tests__/tools/execution.awaitRunning.test.ts`: the MCP path.
   - `backend/src/application/services/__tests__/startupRecovery.test.ts`: sweep before recovery, fail-loud, and the call in `index.ts`.
3. If the code cannot take that path, the model is wrong. Fix the action in the spec, and do not change the rule. Typical modeling errors: an action that is atomic in the model but has an `await` in the middle in the code, or the reverse, or a guard (a `WHERE status ...` condition, a `signal.aborted` check) that the model has and the code lost, or the reverse.

Never weaken a rule, add a guard the code does not have, or drop an action to make a check pass.

## How the code keeps the rules

These are the mechanisms the model checks. Each one was removed in turn, from the code and from the model, and the check failed without it (see "Load-bearing" below).

- **Guarded job writes.** Every `JobQueue` write goes through `KnexJobRepository.updateIfActive`, `UPDATE ... WHERE status IN ('pending','running')`, so a final job is never overwritten.
- **Guarded model writes.** The background run writes the model only through `KnexModelRepository.updateStatusUnlessCancelled`, and only when its own job write was applied (`finalizeModelExecution`, and the `catch` blocks).
- **Kill, confirm, then mark.** `cancelRun` fires the run's `AbortSignal` (`runRegistry`), kills the engine, and waits for confirmation. For Docker that means `docker kill nomad-run-<modelId>`, stopping the compose CLI, then `docker ps` showing nothing by that name. Only after that does it write the job (guarded) and the model `cancelled`. A kill that cannot be confirmed throws `EngineError` (`ENGINE_CANCEL_FAILED`, HTTP 500) and nothing is marked cancelled.
- **No start after a kill.** `DockerExecutor`/`NativeBinaryExecutor.runStream` check `signal.aborted` in the same synchronous block as the spawn.
- **The run defers to the cancel.** After the engine returns or throws, the run calls `run.stoppedByCancel()`. That waits out a kill in flight, and when the kill was confirmed the run writes nothing.
- **Startup sweep, then recovery.** `recoverAfterRestart` (`startupRecovery.ts`), called from `initializeDatabaseLayer` before the server listens, first calls the FireSTARR executor's `killLeftovers()`. In Docker mode that lists every `nomad-run-*` container labelled with this compose project (`COMPOSE_PROJECT_NAME`, which has no default), runs `docker rm -f` on them, and lists again. If the daemon can't be asked or anything is left, it throws, `startServer` exits 1, and the server never listens. Only after a confirmed sweep does `JobQueue.initialize` fail every pending or running job, and give every model still queued or running, or still draft with a job, the outcome of its latest job.
- **MCP awaits mark-running** before launching the run.
- **No default compose project.** `composeProjectName.ts`: in Docker mode `startServer` calls `requireComposeProjectName(process.env)` before anything touches the database or Docker, and exits 1 naming the key when it is unset or blank. `DockerExecutor` reads it the same way: it never starts a run or sweeps under a guessed name.

## Findings this verification found and that are fixed

At e2491b1 the check found these. Each was reproduced with a failing test against the real code before the fix. These tests now pass:

- **F1.** Cancel did not stop the run, and the run overwrote it. `DELETE /jobs/:id` only wrote `cancelled`, and the run's later writes changed it back. The cancel also never touched the model or the container.
- **F2.** Restart recovery skipped pending jobs.
- **F3.** Restart recovery never touched models.
- **F4.** MCP's mark-running write was not awaited and could land after the run had finished.
- **F5.** Startup recovery marked interrupted runs failed but left their containers running. Reproduced on a real Docker daemon: after boot the job said failed and the container was still Up.
- **F6.** `COMPOSE_PROJECT_NAME` fell back to `project_nomad`, so two deployments that never set it shared a label, and one's startup sweep removed the other's running container. Reproduced on a real Docker daemon. Docker mode now refuses to start without it.

While modeling the fix, TLC also found two holes in the first design, before any code was written. Both are fixed, and the model would show them again:

- A run that finished while a cancel was between its two writes could leave the job `cancelled` beside a `completed` model. That is why the run skips its model write when its job write is refused.
- On MCP, a crash in the same window left a `draft` model beside a cancelled job. That is why recovery also settles draft models that have a job.

## Load-bearing

To show a mechanism matters, remove it from the code and run its test. Then remove the same thing from the spec and run `check.sh`. Both must fail. Restore both afterwards. Results at the time of the fix:

| Removed | Tests that fail | Rules that break (all three paths unless noted) |
| --- | --- | --- |
| job write guard (`updateIfActive` condition) | 4 in `JobQueue.finalStatus` | `FinalJobStaysFinal`, `FinishedRunHasFinalJob`, `AcceptedCancelEndsCancelled`, `JobAndModelAgreeOnSuccess`, `JobAndModelAgreeOnCancel` |
| the kill in `cancelRun` | 6 in `jobs.cancel` + `cancelRun` | `CancelledRunHasNoEngine` |
| fail-loud (swallow the kill error) | 2 in `jobs.cancel` + `cancelRun` | `CancelledRunHasNoEngine` |
| the abort before the kill | 1 in `cancelRun` | `CancelledRunHasNoEngine` |
| the run waiting out a kill in flight | 1 in `cancelRun` | `KilledRunEndsCancelled` |
| skip the model write when the job write is refused | 3 in `finalizeModelExecution` | `JobAndModelAgreeOnSuccess`, `JobAndModelAgreeOnCancel` |
| model write guard (`updateStatusUnlessCancelled` condition) | 1 in `cancelRun` | `AcceptedCancelEndsCancelled`, `FinishedRunHasFinalModel`, `JobAndModelAgreeOnCancel` |
| cancel's model write | 3 in `jobs.cancel` + `cancelRun` | `AcceptedCancelEndsCancelled`, `FinishedRunHasFinalModel`, `JobAndModelAgreeOnCancel`, `KilledRunEndsCancelled` |
| recovery of pending jobs | 1 in `JobQueue.recovery` | `RestartLeavesNoPendingJob` |
| recovery of models | 6 in `JobQueue.recovery` | `RestartLeavesNoActiveModel`, `JobAndModelAgreeOnSuccess`, `JobAndModelAgreeOnCancel` |
| recovery of draft models with a job | 1 in `JobQueue.recovery` | `JobAndModelAgreeOnCancel` (mcp only) |
| MCP await alone | none | none: the job write guard already refuses the late write |
| MCP await and the job write guard together | 1 in `execution.awaitRunning` | `FinishedRunHasFinalJob`, `FinalJobStaysFinal`, and four more |
| the startup sweep (`recoverAfterRestart` skips `killLeftovers`) | 2 in `startupRecovery` | `RestartLeavesNoEngine` |
| fail-loud at boot (a failed sweep is swallowed and boot continues) | 1 in `startupRecovery` | `RestartLeavesNoEngine` |
| the sweep's confirmation (`killLeftovers` does not list again) | 1 in `DockerExecutor.cancel` | `RestartLeavesNoEngine` |
| `index.ts` calling `JobQueue.initialize` directly, bypassing the sweep | 3 in `startupRecovery` + `JobQueue.recovery` | `RestartLeavesNoEngine` |
| the `COMPOSE_PROJECT_NAME` requirement (fall back to `project_nomad`) | 6 in `requireComposeProjectName` + `DockerExecutor.cancel` | `compose NoForeignKill`, `compose UnsetNeverServes` |
| the early check in `startServer` alone | 1 in `requireComposeProjectName` (structural) | none: the executor still refuses at the sweep, so boot fails there instead, with a less direct message |

## Update the verification after an intended change

1. Read the diff to the covered code. For each changed status write, await, guard, signal check, kill or new call site, find the action that stands for it in `JobLifecycle.tla`, using the comment above the action. Change that action, or add one and add it to `Next`, so that it again does exactly what the code does. One awaited step is one action.
2. Add a label for any new action to the `steps` table in `view.mjs`.
3. Run `check.sh`. A new BREAK is a bug, in the code or in the model. Settle which with a replay (see above). If a rule really must change, say why here.
4. Update the coverage record below. Then move the sync commit forward to the commit you checked, in this file and in the `git diff` command above. Move it only after you have confirmed that the spec describes the code at that commit.

## Coverage record

Sync commit: `16c4fda` (the verification describes the code at this commit; `check.sh` passed all 41 checks there).

| Code | Spec action(s) |
| --- | --- |
| `backend/src/infrastructure/services/JobQueue.ts`: `enqueue`, `updateStatus`, `complete`, `fail`, `cancel`, `writeIfActive`, `initialize`, `reconcileInterruptedModels` | `EnqueueJob`, `MarkJobRunning`, `CompleteJob`, `FailJob`, `CancelJobWrite`, `StartupRecovery` |
| `backend/src/infrastructure/database/knex/KnexJobRepository.ts`: `updateIfActive`, `failInterrupted` | `GuardedJob`, the guards in `MarkJobRunning`/`CancelJobWrite`, `StartupRecovery` |
| `backend/src/infrastructure/database/knex/KnexModelRepository.ts`: `updateStatusUnlessCancelled`, `updateStatus` | `GuardedModel`, `CancelModelWrite`, `StartupRecovery` |
| `backend/src/domain/entities/Job.ts`, `FireModel.ts`: statuses, `canCancel`, `isTerminal` | `Active`, `Terminal`, `modelSt` values |
| `backend/src/index.ts`: `initializeDatabaseLayer` → `recoverAfterRestart` (startServer exits 1 if it throws) | `ServerCrashes`, `StartupSweep`, `StartupSweepFails`, `StartupRecovery` |
| `backend/src/infrastructure/execution/composeProjectName.ts`: `requireComposeProjectName`, `composeProjectNameFrom`; `index.ts` `startServer` | `ComposeProject.tla`: `BootRefused`, `Project` |
| `backend/src/application/services/startupRecovery.ts`: `recoverAfterRestart` | `StartupSweep`/`StartupSweepFails` before `StartupRecovery`; `bootFailed` |
| `backend/src/application/services/runRegistry.ts`: `register`, `stop`, `stoppedByCancel` | `aborted`, `stopped`, `CancelStartsKill`, `ContainerKilled`, `KillConfirmed`, `Settle` |
| `backend/src/application/services/cancelRun.ts` | `CancelAccepted`, `CancelRejected`, `CancelStartsKill`, `ContainerKilled`, `KillConfirmed`, `KillFails`, `CancelJobWrite`, `CancelModelWrite` |
| `backend/src/api/routes/v1/jobs.ts`: `DELETE /jobs/:id` | calls `cancelRun` |
| `backend/src/infrastructure/firestarr/FireSTARREngine.ts`: `execute` (signal), `cancel` | `StartEngine`, `ContainerKilled`/`KillConfirmed`/`KillFails` |
| `backend/src/infrastructure/docker/DockerExecutor.ts`: `killLeftovers` | `StartupSweep`, `StartupSweepFails` |
| `backend/src/infrastructure/docker/DockerExecutor.ts`: `runStream` (signal check, `--name`), `cancel`, `confirmNoContainer`, `containerNameFor` | `StartEngine`, `ContainerKilled` (`docker kill`), `KillConfirmed` (CLI stopped, `docker ps` empty), `KillFails`, `container` |
| `backend/src/infrastructure/nativebinary/NativeBinaryExecutor.ts`: `runStream` (signal check), `cancel` | same |
| `backend/src/application/services/finalizeModelExecution.ts`, `executeAndFinalizeModel.ts` | `EngineReturns`, `Settle`, `CompleteJob` → `MarkModelCompleted`, `FailJob` → `MarkModelFailed` (model write only if the job write applied) |
| `backend/src/api/routes/v1/models.ts`: POST `/models/run` and POST `/models/:id/execute` background IIFEs and their `catch` | `Path = "run"`, `Path = "execute"` sequences, `EngineInitOk`/`EngineInitThrows` |
| `backend/src/mcp/tools/execution.ts`: `submitModelForExecution` | `Path = "mcp"` sequence |

## Scope and assumptions

Verified: every interleaving of one run's background task, the container, at most one cancel request, and at most one crash at any point followed by startup recovery, on each of the three paths. That is a few hundred distinct states per path, and TLC explores all of them.

Left out:

- **Binary mode.** `NativeBinaryExecutor.killLeftovers()` returns nothing to sweep: a FireSTARR process orphaned by a backend crash has no name to find it by.
- **A compose CLI that survived the crash and is still creating its container.** The sweep sees containers that exist when it lists them.
- **Two deployments that set the SAME `COMPOSE_PROJECT_NAME` on one daemon.** They would sweep each other's runs. `ComposeProject.tla` assumes names that operators set are distinct.
- Open items, with what would close each one, are in `verification/job-lifecycle/OPEN.md`.
- More than one run at a time, more than one restart or cancel, and a user re-running a model after a restart.
- Database writes that fail or throw.
- `progress`, `error` text, `resultIds` and result harvesting. Harvesting runs after both status writes, and its errors are swallowed.
- The legacy `ModelExecutionService` (non-FireSTARR engines). Cancelling a job for an engine type with no registered engine fails loudly, because `getEngine` throws.
- Whether the real Docker daemon behaves as the fake `docker` in `DockerExecutor.cancel.test.ts` does. That test stands for the daemon, and the model assumes the confirmation (`docker ps` by name) is truthful.
- The SSE `/jobs/:id/stream` route, which only reads.

The model treats each conditional `UPDATE` as one atomic step, which it is in SQL. It treats a `JobQueue` method's `findById`→`updateIfActive` as one write at the moment of the `UPDATE`. That is exact for status, because the guard is in the `UPDATE` itself. `cancel`'s earlier `canCancel()` read is the model's `CancelAccepted`.

Run `/pstack:maintain-formal-verification-skill` to bring this verification back in line after changes that were not rechecked.
