# Nomad DIP Re-Scan — Closing Proof (Dependency Inversion Done-When)

**Date:** 2026-06-17
**Scope:** `backend/src/domain/**` (L1 Entities) and `backend/src/application/**` (L2 Use Cases + ports)
**Status:** Closing verification of the architecture remediation. Read-only; no source modified.

## Method (deterministic — import-statement parse, not an LLM graph)

A Node script walked every `.ts` file under `src/domain/**` and `src/application/**` (57 files). For each file it:

1. Extracted **all** import specifiers — both static (`import ... from '...'`) and dynamic (`await import('...')` / `import('...')`) — via regex over every line.
2. Resolved each relative specifier against the filesystem (`.ts`, `.tsx`, `/index.ts`, `.js`) and classified the **target's** layer by path:
   - L1 `domain` = `src/domain/**`
   - L2 `application` = `src/application/**` (incl. `application/interfaces/**` ports — counted inner)
   - L3 `api` = `src/api/**`
   - L4 `infrastructure` = `src/infrastructure/**`; `shared` = `src/shared/**`
3. Flagged every edge where an inner file imports `src/infrastructure/**`, and every edge where a `domain` file imports anything non-`domain`.

External package imports (non-relative) were ignored. Type-only imports were recorded with a `[type]` marker, not silently dropped.

## Counts: Now vs Phase-1 Baseline

| Metric | Phase-1 baseline | Now |
|---|---|---|
| True inner→concretion structural edges | **26** (across 4 files) | **0 true violations** |
| domain → outer edges (infra) | 3 | **0** |
| domain → non-domain relative edges | 3 (`shared/dateParsing`) | **0** |
| application → infrastructure edges | 20 (12 app + 8 port) | **2 — composition root only** |

Baseline source: `Documentation/Nomad/architecture-review/nomad-dip-violations.md` (26 true violations across `TimeRange.ts`, `ModelResultsService.ts`, `IFireModelingEngine.ts`, `INotificationPreferencesRepository.ts`).

### The 2 remaining application→infrastructure edges

Both live in a **dedicated composition-root file** — the legitimate DI wiring seam, not business logic:

- `src/application/services/ModelResultsService.composition.ts:13 -> src/infrastructure/database/index.ts`
- `src/application/services/ModelResultsService.composition.ts:14 -> src/infrastructure/firestarr/ResultArtifactGateway.ts`

This file imports `ModelResultsService` and only `import type { IFireModelingEngine }` from the port; it exists to inject concrete repositories/gateways into the service. The service itself (`ModelResultsService.ts`) is clean. A composition root depending outward is the correct, intended direction under Clean Architecture — it is the one place wiring is allowed. **Not a DIP violation.** It is reported here for full disclosure rather than suppressed.

## Per-Item Verification

| # | Check | Result | Evidence (file:line) |
|---|---|---|---|
| 1 | `TimeRange.ts` imports `./dateParsing`, not `shared/dateParsing` | ✅ | `src/domain/value-objects/TimeRange.ts:2` → `import { parseIsoToDate } from './dateParsing.js'` |
| 2 | `IFireModelingEngine.ts` has no infrastructure imports; weather types from `./weather` | ✅ | `src/application/interfaces/IFireModelingEngine.ts:4` → `import type { WeatherDataPoint, WeatherConfig } from './weather.js'` |
| 3 | `ModelResultsService.ts` has ZERO infra imports (static or dynamic `await import`) | ✅ | No `infrastructure` reference except the explanatory comment at `:568`; no dynamic imports |
| 4 | `INotificationPreferencesRepository.ts` imports the enum from `domain`, not a migration | ✅ | `src/application/interfaces/INotificationPreferencesRepository.ts:9` → `import { NotificationEventType } from '../../domain/entities/NotificationEventType.js'` |
| 5 | No concrete `getFireSTARREngine` import / `as FireSTARREngine` cast outside `infrastructure/` + resolver (api, application, mcp) | ✅ | grep over `api/ application/ mcp/` (non-test): NONE |
| 6 | OCP fix holds: no `switch (engineType)` / `switch (model.engineType)` in non-test source | ✅ | grep `switch\s*\(\s*(model\.)?engineType` over `src/**` (non-test): NONE |

All five named checks plus the OCP check: **6/6 PASS.**

## Remaining Edges (full list)

- `src/application/services/ModelResultsService.composition.ts:13 -> infrastructure/database/index.ts` (composition root — allowed)
- `src/application/services/ModelResultsService.composition.ts:14 -> infrastructure/firestarr/ResultArtifactGateway.ts` (composition root — allowed)

No domain→outer edges. No port→infrastructure edges. No business use-case→infrastructure edges.

## Verdict

**PROVEN: the Dependency Inversion done-when criterion is met — 26 → 0 true inner→infrastructure violations; the only 2 remaining inner→infra edges are an explicit composition root, and all 6 named checks pass.**
