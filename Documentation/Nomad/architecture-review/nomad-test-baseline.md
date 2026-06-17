# Project Nomad — Green Test Baseline

**Date:** 2026-06-14
**Purpose:** Establish GREEN baseline before behavior-preserving refactor phase.
**Method:** Ran existing Vitest suites in run-once mode. No source/test files modified.

## Backend

- **Repo:** `projects/project_nomad/backend`
- **Command:** `npx vitest run` (the `npm test` script maps to watch-mode `vitest`, so run-once form used)
- **node_modules:** present (no install needed)
- **Result:** Test Files **44 passed (44)**, Tests **383 passed (383)**, 0 failed, 0 skipped
- **Duration:** ~25.0s
- **Exit code:** 0

## Frontend

- **Repo:** `projects/project_nomad/frontend`
- **Command:** `npx vitest run` (the `npm test` script maps to watch-mode `vitest`, so run-once form used)
- **node_modules:** present (no install needed)
- **Result:** Test Files **40 passed (40)**, Tests **359 passed (359)**, 0 failed, 0 skipped
- **Duration:** ~18.5s
- **Exit code:** 0

## Verdict

**GREEN** ✅

- Backend: 383/383 pass
- Frontend: 359/359 pass
- Combined: 84 test files, 742 tests, all passing.

## Process Hygiene

- Both runs used run-once mode (`vitest run`) and exited on their own (exit 0).
- No watcher or dev server was spawned by this baseline run.
- `pgrep`/`ps` confirmed no lingering Nomad Vitest/Vite processes started by this task.
- (Two unrelated pre-existing `vite`/`tsx watch` processes from a prior session days ago in a different path were observed but NOT started by this run and were left untouched.)
