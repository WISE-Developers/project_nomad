# Project Nomad — Architecture Drift Inventory (Step 7 Synthesis)

**Read-only synthesis.** Yardstick: `nomad-intended-architecture-spec.md`. Sources reconciled: as-built layer map (Step 2), DIP violations (Step 3), SoC/SRP findings (Step 4), OCP/LSP/ISP findings (Step 5), coverage overlay (Step 6). No new findings introduced; overlapping items merged (notably the `engineType` switch, which appears in both the OCP and coverage findings — folded into a single inventory row, #1).

**This inventory does NOT authorize code changes.** It is the evidence base Franco reviews before any Phase-2 remediation is scoped.

---

## 1. Executive Summary

The backend is near-textbook Clean Architecture: top-level `domain/`, `application/`, `infrastructure/`, `api/`, `core/` with an explicit `application/interfaces/` port layer, and a framework-free domain (no Express/Knex/infrastructure imports). The frontend is organized by feature, not by layer, with exactly one clean Clean-Architecture seam — the doc-mandated `openNomad/` `IOpenNomadAPI` adapter — and no Entities/Use-Cases layer (business logic lives in feature hooks/validators). The engine seam's dependency inversion HOLDS structurally (only `FireSTARREngine` implements `IFireModelingEngine`; zero business-layer edges to the concrete), but OCP FAILS at that seam: callers import the concrete factory and two `switch (engineType)` blocks hardcode the engine roster. Drift is concentrated, not pervasive — one HIGH domain-purity breach (`TimeRange` → `dateParsing`), a cluster of MEDIUM app→infra/port→infra leaks, and one LOW SoC smell in the export bundle builder. Data-service plug-in readiness is **READY-WITH-PREP**: the frontend `IOpenNomadAPI` seam works today (a second adapter already coexists), while the backend would force edits at the engine-selection seam first. On Franco's question — "did we drift?" — the honest answer is **yes, but small and fixable, not pervasive**: the architecture is sound, the violations are few, localized, and each has a clear behavior-preserving remediation shape. The single material risk is that the riskiest drift (the backend `engineType` switches) is also entirely UNCOVERED by tests.

---

## 2. Ranked Drift Inventory

Ranked by: (1) blocks data service, then (2) severity, then (3) remediation risk (drift × absence of test net × blast radius).

| # | Issue | Principle(s) | Location (file:line) | Severity | Blocks data service? | Coverage | Remediation SHAPE |
|---|---|---|---|---|---|---|---|
| 1 | `switch (engineType)` hardcodes engine roster (FireSTARR / vestigial WISE stub / `default`); no `getEngine()` resolver. *(Merged: OCP finding + coverage danger zone #1.)* | OCP | `infrastructure/services/ModelExecutionService.ts:122` (`isEngineAvailable`), `:273` (`getEngineCommand`) | High | **Yes** | Uncovered | Engine/data-source resolver registry |
| 2 | Adapters import the concrete engine factory, not the abstraction — FireSTARR hardcoded at four route call sites; no engine-selection seam. | OCP | `api/routes/v1/results.ts:15,59,171,261,301` (also `jobs.ts`, `models.ts`) | High | **Yes** | Uncovered | Route depends on resolver, not concrete factory |
| 3 | Port imports infra types — `IFireModelingEngine` (`ExecutionOptions`) pulls `WeatherConfig`/`WeatherDataPoint` out of `infrastructure/weather`. Inversion boundary leaks the concretion it should hide. | DIP | `application/interfaces/IFireModelingEngine.ts:1,39` → `infrastructure/weather/types.ts:10,82` | Med | **Partial** | Uncovered (port); impl behavior covered | Lift weather types into the port's own layer |
| 4 | `ModelResultsService` reaches concretely into infra — imports `infrastructure/database/index`, calls `getJobRepository()`/`getResultRepository()` (bypassing the `IJobRepository`/`IResultRepository` ports), plus `firestarr` extractors/tile-gen and `resolveResultFilePath`. | DIP | `application/services/ModelResultsService.ts:1,115,119,126,561` → `infrastructure/database/RepositoryProvider.ts:73,83`, `infrastructure/firestarr/*` | Med | No | Uncovered | Inject repos/extractors via ports |
| 5 | Port imports a **migration** file — `INotificationPreferencesRepository` references `NotificationEventType` defined inside a DB migration. | DIP | `application/interfaces/INotificationPreferencesRepository.ts:1,11` → `infrastructure/database/migrations/005_create_notification_preferences.ts:25` | Med | No | Covered (repo impl) | Relocate enum to a domain/port-side type |
| 6 | Domain entity depends outward on shared utility — `TimeRange` imports/calls concrete `parseIsoToDate()` from `shared/` (an outer ring). Domain is infrastructure-free but not dependency-pure. *(Explicit Dependency-Rule breach.)* | DIP | `domain/value-objects/TimeRange.ts:1,43` → `shared/dateParsing.ts:22` | High* | No | Thin | Relocate/inline the pure parser into `domain/` |
| 7 | `IOpenNomadAPI` reference impl throws "not implemented" for ~10–12 of its methods — contract is ambiguous about what an adapter MUST fulfill vs MAY delegate to a host; an adapter can ship half-implemented and still type-check. | LSP | `openNomad/default/DefaultOpenNomadAPI.ts:345,421,477,491,631,643,778,792,806,845,902` | Med | **Partial** | Thin (3 of ~12 pinned) | Split `spatial.data` vs `spatial.map`; formalize mandatory-vs-host roster |
| 8 | Export bundle builder mixes three reasons-to-change in one module — pure assembler + module-level `bundleStore` Map + import-time `setInterval` TTL sweep (a live timer tied to module load). | SoC/SRP (LOW smell, not a god-component) | `infrastructure/export/ExportBundleBuilder.ts:34-152` (builder), `:158,175-184` (store), `:163-170` (timer) | Low | No | Uncovered | Extract `BundleStore`/`EphemeralBundleCache`; remove import-side-effect timer |

\* #6 severity: HIGH as an explicit Dependency-Rule breach, but LOWEST *remediation* risk (its parser delegate is already covered) — hence it ranks last in the table's risk ordering despite the HIGH label.

**Severity tally (distinct items): High = 3 (#1, #2, #6) · Med = 4 (#3, #4, #5, #7) · Low = 1 (#8). Total = 8 distinct items.**

---

## 3. Danger Zones (drift × uncovered) — characterization test to write FIRST

These are the items where architectural drift meets an absent/thin test net. Write the characterization test BEFORE touching the code (order from coverage overlay, riskiest first):

1. **`ModelExecutionService.ts` engineType switches (L122, L273)** — OCP FAIL, **UNCOVERED**, keystone of the data-service blocker. Riskiest move in the whole set. **Write FIRST (#5):** pin `isEngineAvailable`/`getEngineCommand` behavior for the FireSTARR case, the vestigial WISE stub branch, and the `default` "Unknown engine type" path before introducing the resolver.
2. **`api/routes/v1/results.ts` concrete `getFireSTARREngine` wiring** — OCP FAIL, **UNCOVERED** at the route boundary (only mocked in an MCP test). **Write (#6):** HTTP-level characterization net over the four call sites before redirecting them to a resolver.
3. **`ExportBundleBuilder.ts` builder + store + import-time `setInterval`** — SoC smell, **UNCOVERED**. **Write (#4):** `ExportBundleBuilder.spec.ts` pinning `build()` manifest shape (paths, format, stat-derived sizes) with engine/results deps faked, then `BundleStore.spec.ts` pinning store→get→TTL-evict so the timer can be lifted out of import scope safely.
4. **`ModelResultsService.ts` app→infra concrete reach** — DIP MED, **UNCOVERED**. **Write (#3):** characterization test driving the service with fake repos — assert it aggregates results for a known modelId and surfaces the not-found path — before inverting the repository dependency.
5. **`DefaultOpenNomadAPI` / `IOpenNomadAPI` "not implemented" roster** — LSP FAIL, **THIN** (only 3 of ~12 throwing methods pinned). **Extend (#8):** pin the full throwing roster before splitting the contract. Mid risk — OCP is clean so new adapters already coexist.
6. **`TimeRange.ts` `fromISO`/`validateDates`** — DIP HIGH but lowest remediation risk; delegate already COVERED. **Write (#1):** a quick spec for `fromISO` bad-start/bad-end throws and `new TimeRange(end, start)` rejection before re-pointing the parser dependency.

---

## 4. What Is CLEAN (do NOT touch)

Honesty and morale matter here — most of the architecture is sound. Confirmed-passing:

- **Domain purity** — `domain/**` (216 nodes) has **zero** edges to Express, Knex, Docker, gdal, or `infrastructure/`. Framework-free. **The one and only outward edge is `TimeRange` → `dateParsing`** (item #6); everything else in the domain is pure.
- **Repository ports** — all three seams PASS OCP/LSP/ISP. `IJobRepository` is a focused contract; the Knex impl fulfills it with no stubs/throws. Substitutable. Supported by `KnexNotificationPreferencesRepository.test.ts`.
- **Engine-seam LSP/ISP** — `IFireModelingEngine` is a clean 8-method port; `FireSTARREngine` is the sole implementer with no stub methods (LSP PASS); the interface is appropriately narrow (ISP PASS). The **dependency inversion HOLDS** (only failure at this seam is OCP, item #1/#2). Impl behavior is COVERED via buildCommand/output-config tests.
- **`openNomad` OCP & ISP** — OCP clean: a Data Service ships as a new `IOpenNomadAPI` impl via `OpenNomadProvider` with **zero consumer edits** (`ExampleAgencyAdapter` already proves a 2nd impl coexists). ISP exemplary: 6 namespaced modules (`auth`/`models`/`jobs`/`results`/`spatial`/`config`); consumers touch only what they need.
- **SoC / SRP** — **0 genuine SRP violations.** The three graphify low-cohesion communities (Dashboard container, Backend Validation leaf, `ValidationError` bridge) are benign graph artifacts; `ValidationError` is a correct inward-pointing shared kernel. The only actionable SoC item is the LOW-severity lifecycle/timer split in `ExportBundleBuilder` (#8).
- **`shared/dateParsing.ts`** — COVERED (parse + all throw paths + context label pinned); safe to relocate.

---

## 5. Phase 2 Entry Criteria

Phase 2 is **behavior-preserving and test-guarded.** Each remediation is gated on its characterization test passing FIRST (red→green→refactor; no code change before the test pins current behavior). Ordered:

1. **Backend engine-selection seam (#1 + #2)** — leads, because it is simultaneously the #1 danger zone AND the data-service blocker. Gate: characterization tests for both `ModelExecutionService` switches (danger-zone #1) and an HTTP-level net over `results.ts` (danger-zone #2). Then introduce a `getEngine(engineType): IFireModelingEngine` resolver registry, redirect routes to the abstraction, and delete the two switches in one composition-root move.
2. **Port infra-leak cleanup (#3)** — lift `WeatherConfig`/`WeatherDataPoint` into the port's own layer (naturally bundled with the #1 refactor so a new engine isn't forced onto FireSTARR's infra types). Gate: engine-seam impl tests already covered; add port-contract assertion.
3. **`ModelResultsService` port injection (#4)** — gate: fake-repo characterization test (danger-zone #4), then invert the repository/extractor dependencies.
4. **`IOpenNomadAPI` contract split (#7)** — gate: full throwing-roster pinned (danger-zone #5), then split `spatial.data` vs `spatial.map` and formalize mandatory-vs-host methods (restores LSP, hardens the data-service contract).
5. **`ExportBundleBuilder` lifecycle extraction (#8)** — gate: builder + BundleStore specs (danger-zone #3), then extract `BundleStore` and remove the import-time timer.
6. **`TimeRange` parser relocation (#6) + notification enum relocation (#5)** — lowest-risk, do last. Gate (#6): quick `fromISO`/`validateDates` spec; delegate already covered.

**Reminder: this inventory does not authorize code changes — it scopes them. No Phase-2 edit begins until its gating characterization test is green on current behavior.**

---

## 6. Stale-Doc Notes (documentation drift — fix separately)

Carried forward from the Step 1 yardstick gaps. These are *documentation* conflicts, not code defects, and should be reconciled independently of the remediation above:

- **SpatiaLite vs SQLite** — the intended-architecture spec names SpatiaLite; `ARCHITECTURE.md` describes SQLite/better-sqlite3. One is stale.
- **WISE vs FireSTARR-only** — spec and `CLAUDE.md` treat WISE as an engine; auto-memory records "FireSTARR only" and the codebase confirms it (the WISE switch branch is a vestigial `echo "not yet implemented"` stub). Docs predate the abandonment.
- **Docs predate the backend layer layout** — Nomad's own docs contain no directory→layer map and assume business rules live in `services/`; the backend has since been refactored into named `domain/`/`application/`/`infrastructure/` layers. The yardstick's `services/`-buried-logic assumption is outdated.
- **Also unspecified in docs:** no documented repository interface, no documented backend engine interface, no enforcement mechanism (no lint import-boundary config / allowed-import matrix), and no Presenters analog. Several Step-2 layer assignments are therefore inferred, not doc-backed — noted where it matters in the table above (e.g. all frontend `features/*` layer placements are inferred).
