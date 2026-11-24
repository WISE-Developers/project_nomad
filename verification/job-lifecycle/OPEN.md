# Open items: job lifecycle verification

Things this work found but did not settle. Each says what is wrong, why it was left, and what would close it. The verification skill is `.claude/skills/verify-job-lifecycle/SKILL.md`, and its "Scope and assumptions" section lists the modeling bounds.

## 1. No installer writes `COMPOSE_PROJECT_NAME` (blocks merge)

**What.** In docker mode the backend now refuses to start until `COMPOSE_PROJECT_NAME` is set, with no default. `.env.example` ships the key blank, and none of the installers writes it. `install_nomad_setup.sh`, `install-nomad-demo.sh` and `install-nomad-headless.sh` are the ones `update_env_value_all_installers.test.sh` covers, and there are others under `scripts/`. **A fresh install made by any of them will not boot** until the operator adds the key by hand. The backend logs why and exits 1.

**Why it was left.** Choosing the value is the decision the "no default" rule is about. If an installer writes a fixed name, every install gets that name again. Deriving it from the install folder is what Docker Compose does on its own, and two installs in folders with the same name would still collide. Ask the operator, as the installer already does for `NOMAD_HOME_TIMEZONE`, or derive it with the operator confirming? That is a product call.

**To close.** Pick the rule. Write the key in every installer, following the `NOMAD_HOME_TIMEZONE` pattern: prompt, validate, then `update_env_value`. Add a `scripts/__tests__/` check, like `home_timezone_key.test.sh`, that every installer covers it. Existing deployments are covered by the new entry at the top of `Documentation/Nomad/upgrading.md`.

## 2. Binary-mode orphans are not swept

**What.** At startup, `NativeBinaryExecutor.killLeftovers()` returns nothing to sweep. When the backend dies in binary mode (`FIRESTARR_EXECUTION_MODE=binary`), a FireSTARR process it spawned can keep running beside a job that recovery has just marked failed. It keeps using CPU and writing into the model's sim directory.

**Why it was left.** A native process has no name or label to find it by. The only handle is the in-memory `ChildProcess`, which dies with the backend. Matching by command line or working directory could kill an unrelated process.

**To close.** Give each run something findable: a pid file in the run's working directory, or a process group whose id is recorded in the job row. `killLeftovers()` then kills what those point at and confirms it exited. Model it like the Docker sweep (`StartupSweep` / `StartupSweepFails` in `JobLifecycle.tla`, rule `RestartLeavesNoEngine`) and prove it the same way.

## 3. A compose CLI that outlives the crash can create its container after the sweep

**What.** The startup sweep removes the `nomad-run-*` containers that exist when it lists them. A `docker compose run` CLI started by the dead backend can survive it (seen on a real daemon: the CLI survived SIGTERM). If that CLI is still between "asked the daemon to create the container" and "container exists" when the sweep lists, its container appears just after the sweep. It then runs with no backend driving it.

**Why it was left.** The window is narrow: a crash during the second or so of container creation. The model treats container creation as one atomic step, so it cannot show this.

**To close.** Either give the sweep a short settle-and-relist loop (list, remove, wait, list again until two lists agree), or stop the gap at its source: at startup, before sweeping, find and kill compose CLIs whose argument list names `nomad-run-`. Either way, split `StartEngine` in the model into "CLI started" and "container exists", so that `RestartLeavesNoEngine` can see the race.

## 4. Stray folder `ewvSBuYg85x_SrS_k8QT9/` in the repo root

**What.** It appeared in the repo root on 2026-11-23 at 17:58, during a full test run in this work. It holds `client/` with about 180 files, each named by a 40-character hash. It is not gitignored and was not committed.

**Why it was left.** Nothing in this change creates it, and its origin wasn't confirmed, so it wasn't deleted. In this sandboxed session, temp files from test runs landed in the working directory: `fake-docker-state-*`, `streamzip-*` and `node-compile-cache` did, and were removed. This looks like the same thing, from a frontend build or test cache.

**To close.** Find what writes it (search the frontend test and build config for `client`, or watch a full `npx vitest run` in `frontend/`), then delete it. If a test writes into the repo when `TMPDIR` is redirected, make it write to `os.tmpdir()` and clean up after itself.

## 5. Script tests that fail, not because of this change

- `release_only_after_image.test.sh` fails on the base commit `e2491b1` too.
- `update_env_value_all_installers.test.sh` and `firestarr_registry_current.test.sh` fail only on the untracked local file `scripts/install-nomad-headless.local-2026-03-24.sh`. They pass on a clean checkout.
