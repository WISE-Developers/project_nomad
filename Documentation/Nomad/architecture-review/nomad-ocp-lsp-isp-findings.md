# Nomad OCP / LSP / ISP Findings — Step 5 (Seam Interrogation)

**Method:** Read the three key seam interfaces, their implementers, and their callers. Verdicts are evidence-backed with `file:line`. Read-only; no source modified. Scope discipline applied — small focused ports are scored as GOOD, not flagged for invented splits.

**Verdict grid:**

| Seam | OCP | LSP | ISP |
|---|---|---|---|
| IFireModelingEngine (backend) | **FAIL** | PASS | PASS |
| IOpenNomadAPI (frontend) | **PASS** | **FAIL** | PASS |
| Repository ports (backend) | **PASS** | PASS | PASS |

---

## Seam 1 — IFireModelingEngine (backend engine port)

**Interface:** `backend/src/application/interfaces/IFireModelingEngine.ts`
**Implementer:** `backend/src/infrastructure/firestarr/FireSTARREngine.ts` (the *only* `implements IFireModelingEngine`)
**Factory:** `getFireSTARREngine(): IFireModelingEngine` (FireSTARREngine.ts ~L? singleton at end of file)
**Callers:** `api/routes/v1/results.ts` (L15, L59, L171, L261, L301), `jobs.ts`, `models.ts`, `mcp/tools/execution.ts`, `ModelResultsService.ts`, `ExportBundleBuilder.ts`.

### OCP — **FAIL**
The port itself is clean (8 methods, returns `IFireModelingEngine` from a factory), but adding a 2nd engine WOULD force caller edits in two concrete places:

1. **Callers import the concrete factory, not the abstraction.**
   `api/routes/v1/results.ts:15` —
   `import { getFireSTARREngine, ... } from '../../../infrastructure/firestarr/index.js';`
   then `const engine = getFireSTARREngine();` at L59, L171, L261, L301. The adapter layer reaches directly into `infrastructure/firestarr` and hardcodes FireSTARR. A second engine cannot be selected here without editing every route — there is no engine-selection seam (no registry/`getEngine(engineType)` resolver).

2. **`switch (engineType)` on an enum in a caller.**
   `infrastructure/services/ModelExecutionService.ts:122` (`isEngineAvailable`) and `:273` (`getEngineCommand`) both `switch` on `EngineType`, with explicit `case EngineType.FireSTARR` / `case EngineType.WISE` / `default: 'Unknown engine type'`. Adding an engine means adding a `case` to these switches — textbook OCP breach. (The WISE branch is a vestigial stub emitting `echo "WISE engine not yet implemented"`.)

**Telltales present:** concrete-factory import in adapters + `switch` on engine-type enum in callers. To add an engine you edit `results.ts` and two `switch` statements.

### LSP — **PASS**
`FireSTARREngine` honors the full contract. No "not implemented" throws; the only throws are legitimate domain errors (`getStatus`/`getResults` throw when a model is genuinely absent, documented as "callers fall back to database"). `cancel()` no-ops gracefully when no state exists. `validateLocation` returns a real coverage check. No method is narrowed or stubbed away. Substitutable.

### ISP — **PASS**
8 cohesive lifecycle methods (`getCapabilities`, `initialize`, `execute`, `getStatus`, `getResults`, `cancel`, `cleanup`, `validateLocation`). All belong to a single engine-execution responsibility. Not fat; no client forced to depend on unused surface. Do NOT split.

**DIP note (carried from Step 3, not re-litigated):** the port imports `WeatherConfig`/`WeatherDataPoint` from `infrastructure/weather/types.js` (IFireModelingEngine.ts:5) — abstraction leaks a concretion. Relevant to OCP-readiness because a new engine inherits the infra-typed contract.

---

## Seam 2 — IOpenNomadAPI (frontend data/adapter seam)

**Interface:** `frontend/src/openNomad/api.ts` (`export interface IOpenNomadAPI`)
**Reference impl:** `frontend/src/openNomad/default/DefaultOpenNomadAPI.ts`
**Agency template:** `frontend/src/openNomad/examples/ExampleAgencyAdapter.ts` (imports `IOpenNomadAPI`, copy-to-implement)
**Injection:** `openNomad/context/OpenNomadContext.tsx` via `OpenNomadProvider` (React context). UI consumes `useOpenNomad()`, never a concrete adapter.

### OCP — **PASS**
This is the textbook-correct seam. A new adapter (agency or future Data Service) plugs in by implementing `IOpenNomadAPI` and being passed to `OpenNomadProvider`. No caller edits required — the Dashboard depends on the interface through context. `ExampleAgencyAdapter.ts` proves a 2nd implementation already coexists. No `instanceof`, no adapter-type switch in consumers. Closed for modification, open for extension.

### LSP — **FAIL**
`DefaultOpenNomadAPI` does NOT honor the full contract — it throws `"... is not implemented in the default adapter"` for a large fraction of the interface:
- `models.create()` (L345), `models.update()` (L421)
- `jobs.submit()` (L477), `jobs.cancel()` (L491)
- `results.getData()` (L631), `results.export()` (L643)
- `spatial.drawPoint()` (L778), `drawLine()` (L792), `drawPolygon()` (L806), `addLayer()` (L845)
- `spatial.getWeatherStations()` returns empty array "not implemented" (L902-906)

~10–12 of the surface methods are unfulfilled. A consumer holding an `IOpenNomadAPI` cannot safely call these on the default adapter — substitutability is violated. This is partly *by design* (SAN's map/draw is host-provided in ACN), but as written the contract promises behavior the reference impl cannot deliver. **This is the LSP smell that matters for the Data Service** (see readiness).

### ISP — **PASS (exemplary)**
Deliberately segregated into 6 namespaced modules — `auth`, `models`, `jobs`, `results`, `spatial`, `config` (plus top-level `fetch`/`getBaseUrl`). The docs call this out as the ISP exemplar. Consumers touch only the module they need (`api.models.list`, `api.jobs.submit`). Good as-is; no split needed. *Caveat:* `spatial` blends data-services (weather/fuel/elevation) with map-interaction (draw/layer) — that blend is the root of the LSP gaps above, and is the natural fault line IF a split were ever warranted (`spatial.data` vs `spatial.map`). Not urgent.

---

## Seam 3 — Repository ports (backend persistence)

**Ports:** `application/interfaces/IJobRepository.ts`, `IResultRepository.ts`, `IModelRepository.ts`, `INotificationPreferencesRepository.ts`, `ISpatialRepository.ts`, `IWeatherRepository.ts`
**Implementers:** `KnexJobRepository`, `KnexResultRepository`, `KnexModelRepository`, `KnexNotificationPreferencesRepository` (wired in `infrastructure/database/RepositoryProvider.ts:50-53`)
**Resolvers:** `getJobRepository()` (L73), `getResultRepository()` (L83), etc. — return the port type.

### OCP — **PASS**
SAN/ACN (SQLite vs PostgreSQL) is handled by Knex *inside* a single `Knex*` implementer, not by branching in callers. `RepositoryProvider` constructs concretes once and hands back the *interface* (`getJobRepository(): IJobRepository`). A new backing store = a new `IJobRepository` impl wired in one place. No `instanceof`/store-type switch in callers. (`DeploymentMode = 'SAN' | 'ACN'` exists at L16 but drives Knex client config, not caller branching.)

### LSP — **PASS**
`IJobRepository` is a focused CRUD+query contract (`save`, `update`, `findById`, `findByStatus`, `findByModelId`, `findAll`, `delete`, `exists`, `markRunningAsFailed`, `deleteOlderThan`, `deleteByModelId`). The Knex impl fulfills all; no stubs/throws observed. Substitutable.

### ISP — **PASS**
Ports are split per-aggregate (job / result / model / notification-prefs / spatial / weather) rather than one god-repository. `IJobRepository`'s 11 methods are all job-persistence concerns. Focused. No split warranted.

**DIP note (Step 3):** `INotificationPreferencesRepository.ts:?` imports `NotificationEventType` from a DB *migration* file — concretion leak in a port. Does not change the OCP/LSP/ISP verdicts but should be relocated.

---

## Data Service Plug-In Readiness — THE PAYOFF

**Verdict: READY-WITH-PREP.**

The future "Open Nomad Data Service" must plug in at (a) the frontend `IOpenNomadAPI` seam and (b) a backend data/engine port. Per-seam:

**Frontend (`IOpenNomadAPI`) — READY structurally, prep on the contract.**
- OCP is clean: the Data Service ships as a new `IOpenNomadAPI` implementation, registered via `OpenNomadProvider`. **Zero consumer edits** — `ExampleAgencyAdapter` already proves a 2nd impl coexists.
- BUT the LSP gap is the trap: because `DefaultOpenNomadAPI` legally throws "not implemented" for ~12 methods, the *interface contract is ambiguous about what an adapter MUST fulfill vs MAY delegate to a host*. A Data Service adapter could ship half-implemented and still "satisfy" the type while breaking consumers that assume the method works.
  **Prep:** Formalize which `IOpenNomadAPI` methods are mandatory-for-a-data-adapter vs host-provided (the `spatial` map-interaction methods are host concerns; the *data* methods — `models`, `jobs`, `results`, `spatial.getWeatherStations/getFuelTypes/getElevation`, `config` — are what a Data Service owns). Ideally split `spatial` into `spatial.data` (Data-Service-owned) and `spatial.map` (host-owned) so the Data Service implements a contract it can fully honor (restores LSP).

**Backend (engine/data port) — BLOCKED until the engine-selection seam exists.**
- The engine seam currently has NO resolver: adapters `import { getFireSTARREngine }` directly (`results.ts:15`) and two `switch (engineType)` blocks hardcode the engine roster (`ModelExecutionService.ts:122,273`).
- A new backend data/engine source CANNOT plug in without editing `results.ts` (and jobs/models routes) plus both switches. **This is the OCP blocker.**
  **Prep:** Introduce an engine/data-source resolver (e.g. `getEngine(engineType): IFireModelingEngine` registry) so routes depend on the abstraction and selection happens in one composition-root place; remove the `EngineType` switches in `ModelExecutionService`. Also lift `WeatherConfig`/`WeatherDataPoint` out of `infrastructure/weather` into the port's own layer so a new engine isn't forced to depend on FireSTARR's infra types.

**Net:** The frontend seam is the strong one (plug-in works today; tighten the contract to be safe). The backend is where the Data Service would force changes first — a one-time refactor to add an engine/data-source resolver and delete the engine-type switches unblocks it. Hence **READY-WITH-PREP**, not READY: the prep is the backend selection seam + the `IOpenNomadAPI` mandatory-vs-host contract clarification.
