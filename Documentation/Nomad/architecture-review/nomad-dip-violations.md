# Nomad DIP Violations — Step 3 (Dependency Direction Proven With Data)

**Method:** Classified all 3,290 graph nodes by `source_file` into Clean Architecture layers, then iterated all 6,881 directed edges. Counted structural dependency edges (`calls`, `imports`, `imports_from`, `references`, `implements`, `instantiates`, `extends`, `inherits`, `uses`) where the **source is an inner layer and the target is an outer layer** (rank(source) < rank(target)). Doc-only/semantic relations (`conceptually_related_to`, `semantically_similar_to`, `rationale_for`, `cites`, `shares_data_with`) and intra-file relations (`contains`, `method`, `defines`, `re_exports`) were excluded from the hard proof. Graph commit: `40`-prefixed `built_at_commit`.

Layer ranks: L1 domain (1) < L2 application + L2 ports (2) < L3 api adapters / FE openNomad (3) < L4 infrastructure / other-backend / FE UI (4).

Node counts by layer: L1_domain 216 · L2_app 73 · L2_port 70 · L3_api 115 · L4_infra 555 · L4_other_be 349 (core/, mcp/, shared/, services/, types/, index.ts) · FE_openNomad 132 · FE_ui 1103.

---

## Summary Counts

**Total inner→outer structural DEP edges: 132.** Breakdown by layer pair:

| Layer pair | Edges | Verdict |
|---|---|---|
| `L3_api → L4_infra` | 79 | **INFO / allowed** — adapters depending on frameworks is the correct outward direction. Not violations. |
| `L3_api → L4_other_be` | 9 | **INFO / allowed** — adapters → core/shared frameworks. Not violations. |
| `FE_openNomad → FE_ui` | 18 | Mostly allowed (see Frontend note); 14 go to `services/api.ts` (a gateway), 1 to DashboardContainer, 3 to test mocks. Low concern. |
| `L2_app → L4_infra` | 12 | **TRUE VIOLATION** — use-case layer depends on concrete infrastructure. |
| `L2_port → L4_infra` | 8 | **TRUE VIOLATION** — port interfaces import concrete infra types. |
| `L2_app → L4_other_be` | 3 | **TRUE VIOLATION (low)** — use-case depends on `shared/dateParsing.ts` concretion. |
| `L1_domain → L4_other_be` | 3 | **TRUE VIOLATION (high)** — entity (`TimeRange`) depends on `shared/dateParsing.ts` concretion. |

**True violations (inner business layer → concretion): 26 structural edges** across **3 source files** (`TimeRange.ts`, `ModelResultsService.ts`, `IFireModelingEngine.ts`, `INotificationPreferencesRepository.ts`).
**Acceptable / port-mediated or adapter→framework: 106 edges** (the 88 `L3_api→L4*` plus the 18 FE seam edges). No domain/app edge was found that resolves to a *port* target — every suspect edge resolved to a concretion, so none are "healthy port-mediated" false alarms.

---

## Confirmed Violations Table

| Source node | Src layer | Target node | Tgt layer | Relation | File:line | Concrete/Port | Severity |
|---|---|---|---|---|---|---|---|
| `TimeRange.ts` (module) | L1 domain | `dateParsing.ts` | L4 shared | imports_from | `domain/value-objects/TimeRange.ts:1` | Concrete | **HIGH** |
| `TimeRange.fromISO()` | L1 domain | `parseIsoToDate()` | L4 shared | imports / calls | `domain/value-objects/TimeRange.ts:43` → `shared/dateParsing.ts:22` | Concrete | **HIGH** |
| `ModelResultsService.ts` | L2 app | `infrastructure/database/index.ts` | L4 infra | imports_from | `application/services/ModelResultsService.ts:1` | Concrete | **MED** |
| `ModelResultsService.ts` | L2 app | `getJobRepository()` / `getResultRepository()` | L4 infra | imports / calls | `ModelResultsService.ts:1,115,119` → `infrastructure/database/RepositoryProvider.ts:73,83` | Concrete (bypasses `IJobRepository`/`IResultRepository` ports) | **MED** |
| `ModelResultsService.ts` | L2 app | `FireSTARRInputGenerator.resolveResultFilePath()` | L4 infra | imports / calls | `ModelResultsService.ts:1,126,561` → `infrastructure/firestarr/FireSTARRInputGenerator.ts:357` | Concrete | **MED** |
| `ModelResultsService.getResults()` | L2 app | `extractDeterministicPerimeters()` | L4 infra | calls | `ModelResultsService.ts:126` → `infrastructure/firestarr/ArrivalTimeExtractor.ts:89` | Concrete | **MED** |
| `ModelResultsService.getResults()` | L2 app | `findArrivalTifs()` | L4 infra | calls | `ModelResultsService.ts:126` → `infrastructure/firestarr/ArrivalTimeTileGenerator.ts:85` | Concrete | **MED** |
| `ModelResultsService.getResults()` | L2 app | `infrastructure/firestarr/index.ts` | L4 infra | imports_from | `ModelResultsService.ts:126` → `infrastructure/firestarr/index.ts:1` | Concrete | **MED** |
| `ModelResultsService.ts` | L2 app | `parseIsoToDate()` | L4 shared | imports / calls | `ModelResultsService.ts:1,126` → `shared/dateParsing.ts:22` | Concrete | **LOW** |
| `IFireModelingEngine.ts` (ExecutionOptions) | L2 port | `WeatherConfig`, `WeatherDataPoint` | L4 infra | imports_from / references | `application/interfaces/IFireModelingEngine.ts:1,39` → `infrastructure/weather/types.ts:10,82` | Concrete (port imports infra types) | **MED** |
| `INotificationPreferencesRepository.ts` (NotificationPreference) | L2 port | `NotificationEventType` | L4 infra | imports / references | `application/interfaces/INotificationPreferencesRepository.ts:1,11` → `infrastructure/database/migrations/005_create_notification_preferences.ts:25` | Concrete (port imports a **migration** file) | **MED** |

Notes:
- The `L2_port → L4_infra` edges are the most architecturally corrosive of the medium set: a *port* is supposed to be the inversion boundary, yet `IFireModelingEngine` pulls weather types out of `infrastructure/weather`, and `INotificationPreferencesRepository` pulls an enum out of a **database migration**. The abstraction leaks the concretion it is meant to hide. Fix = move `WeatherConfig`/`WeatherDataPoint`/`NotificationEventType` into `domain/` or `application/interfaces/`.
- `ModelResultsService` is the single worst use-case offender: it reaches into `RepositoryProvider`, `firestarr/*`, and `database/index` directly instead of receiving `IJobRepository`/`IResultRepository`/engine ports via constructor injection. This matches the Step-2 "Won't cleanly place" flag.

---

## Engine Seam Verdict

**THE INVERSION HOLDS.** Evidence:
- The only node implementing `IFireModelingEngine` is the concrete `FireSTARREngine` (`infrastructure/firestarr/FireSTARREngine.ts`) — exactly one `implements` edge, pointing the correct (outer→inner) way.
- **Zero** structural edges were found where any `domain/` or `application/` node depends on the concrete `FireSTARREngine`. The 29 `FireSTARREngine.*` nodes are referenced only from within infrastructure / composition wiring, never from business layers.
- Caveat: the *port itself* (`IFireModelingEngine.ts`) is contaminated by importing concrete `infrastructure/weather/types.ts` (see table). The dependency *direction* of the engine abstraction is correct, but the port is not fully infra-free.

---

## Domain Purity Verdict

**NOT fully framework-free — REFUTED on one count.** The domain layer (`backend/src/domain/**`, 216 nodes) has **no edges to Express, Knex, Docker, gdal, or `infrastructure/`** — confirming the bulk of Step 2's claim. **However**, `domain/value-objects/TimeRange.ts` imports and calls the concrete `parseIsoToDate()` from `backend/src/shared/dateParsing.ts` (3 edges). `shared/` is an outer (Frameworks/cross-cutting) module, so this is a genuine outward edge from an entity — a HIGH-severity Dependency-Rule breach, even though `dateParsing` is a pure utility with no I/O. Domain is *infrastructure-free* but not *dependency-pure*. Fix = relocate `parseIsoToDate` into `domain/` (it is pure logic) or inline it.

---

## Frontend Note

DIP is **largely N/A** on the frontend: there is no Entities or Use-Cases layer, so business logic is fused into the UI (Frameworks) ring. The only Clean-Architecture seam is `openNomad/` (`IOpenNomadAPI`).

**The UI depends on the abstraction, not around it:** 134 structural edges run `FE_ui → FE_openNomad` (correct direction — components consume the `IOpenNomadAPI` seam). The 18 reverse-direction `FE_openNomad → FE_ui` edges are dominated by 14 to `services/api.ts` (the HTTP gateway the `DefaultOpenNomadAPI` adapter legitimately wraps) and 3 to test mocks; only **1** touches a UI component (`DashboardContainer.tsx`). The openNomad seam is therefore being respected — the UI does not reach around it to a concrete backend. Low concern; the lone DashboardContainer edge is worth a manual glance but is not a structural reach-around of the abstraction.
