# Nomad Separation-of-Concerns / SRP Findings — Step 4

**Read-only.** Yardstick: `nomad-intended-architecture-spec.md`. Layer map: `nomad-as-built-layer-map.md`. DIP data: `nomad-dip-violations.md`. Graph: `graphify-out/graph.json` (undirected; communities + source_files pulled in sandbox, files Read for judgement). Graphify flagged three LOW-COHESION communities and one cross-community BRIDGE node. SRP test applied strictly: a unit is only flagged if it has **multiple reasons to change**. Healthy container size, big style objects, and thin barrels are NOT violations.

---

## 1. "Dashboard Container UI" (community 0, cohesion ~0.06)

**File:** `frontend/src/features/Dashboard/components/DashboardContainer.tsx` (911 LOC, 24 graph nodes; community also pulls in `openNomad/customization/*` which is a *separate* file group, see note).

**Verdict: ARTIFACT.**

**What it actually is:** A composition-root container for the Dashboard feature. The 911 lines are **five distinct sub-components** in one file — `TabNavigation` (L147), `DashboardContent` (L226), `FloatingDashboard` (L314), `EmbeddedDashboard` (L539), `InnerDashboard` (L637), plus the public `DashboardContainer` (L749) — followed by a ~120-line `CSSProperties` styles block (L794–910) and extensive JSDoc usage examples (L687–748).

**Why the low score is benign:**
- **No data layer.** `fetch(` count = 0. Data comes from the `useJobs` hook (L:`import { useJobs }`) and `DashboardContext`; the container does not fetch or transform — it wires and renders. That is exactly what a Frameworks-ring container should do.
- The handlers (`handleResumeDraft`, `handleViewModel`, `handleWizardComplete`, `handleWizardCancel`) are thin delegations to injected `on*` callbacks, not embedded business logic.
- Low graph cohesion here is a **measurement artifact**: a styles object, JSDoc, and several loosely-coupled presentational sub-components naturally have few internal call-edges. Low edge density ≠ tangled responsibilities.
- The `openNomad/customization/*` nodes share the community by semantic similarity (theming/labels), not because `DashboardContainer` owns them — they are an independently-cohesive white-label config group.

**Caveat (not a violation):** the file is large enough that splitting `FloatingDashboard`/`EmbeddedDashboard` into sibling files would aid readability, and the DIP report's lone `FE_openNomad → DashboardContainer` reverse edge is worth a glance. Neither is an SRP breach. **Severity: NONE (cosmetic-only).**

---

## 2. "Backend Validation" (community ~1/96, ValidationError cluster, cohesion ~0.06)

**File:** `backend/src/domain/errors/ValidationError.ts` (121 LOC) extending `DomainError`.

**Verdict: ARTIFACT.**

**Responsibilities — exactly one:** represent an input/business-rule validation failure as a domain error. Everything in the class serves that single purpose: `fieldErrors` data, named constructors (`forField`, `forFields`, `required`, `outOfRange`, `invalidFormat`, `invalidEnum` — L41–93), accessors (`hasFieldErrors`, `getFieldError`), and `toJSON` serialization (L109). The static factories are convenience constructors for *one* concept, not separate jobs. It performs **no validation itself**, touches no I/O, imports only its own `DomainError` base.

**Why the low score is benign:** A leaf domain value/error type has almost no *outbound* edges (it depends on nothing but its base class), so any community built around it scores low cohesion by construction. The graph community is loose because its members are scattered *consumers*, not collaborators. This is the signature of a healthy shared-kernel type, not a god-class. **Severity: NONE.** (The real SoC concern in this area lives in the *validators*, not the error type — and the as-built layer map already notes the frontend validators are fused into UI; that is the DIP report's territory, not an SRP defect of this file.)

---

## 3. "Export Bundle Builder" (community 2, cohesion ~0.08)

**File:** `backend/src/infrastructure/export/ExportBundleBuilder.ts` (192 LOC).

**Verdict: PARTIAL — genuine but LOW-severity SRP smell (one file, ~3 reasons to change).**

**Distinct responsibilities tangled in one file:**
1. **Bundle assembly (the builder)** — `ExportBundleBuilder` class (L34–152): fluent `forModel`/`addItem`/`addItems` + `build()` orchestrating result lookup, path resolution, format conversion, file `stat`, manifest construction. This is the file's legitimate job. *(It also reaches concretely into `getModelResultsService`, `getFireSTARREngine`, `resolveResultFilePath` — but that is a DIP concern already logged in `nomad-dip-violations.md`, not SRP.)*
2. **Bundle lifecycle storage** — a module-level `bundleStore = new Map` (L158), `storeBundle`/`getBundle` (L175–184). A persistence/caching concern bolted onto the builder module.
3. **Garbage-collection scheduling** — a top-level `setInterval` (L163–170) running a TTL sweep every 5 minutes, executed as an import side-effect.

The builder's reason-to-change (export assembly logic) is different from the store's reason-to-change (retention/lifecycle policy) and different again from the GC timer's (eviction cadence / process-lifecycle management). Three reasons to change → SRP smell.

**Where the seam SHOULD be (SHAPE only — not the refactor):**
- Keep `ExportBundleBuilder` as the pure assembler.
- Extract the `Map` + `storeBundle`/`getBundle` + TTL `setInterval` into a small `BundleStore` (or `EphemeralBundleCache`) unit owning retention policy. The import-time `setInterval` side-effect is the sharpest edge — it ties module load to a live timer, which also complicates testing and clean shutdown.

**Severity: LOW.** Real, but small and contained; the timer-as-import-side-effect is the part most worth splitting.

---

## 4. BRIDGE NODE — `ValidationError` (reaches domain, FireSTARR engine, repo-area, ACN error middleware)

**Verdict: ARTIFACT — acceptable cross-cutting shared kernel. NO concern-leak.**

**Why it bridges so many communities:** It is imported by 22 non-test files spanning `api/middleware` (1), `api/routes` (4), `application/perimeters` (4), `application/use-cases`/`common` (2), `infrastructure/firestarr` (4), `infrastructure/config` (2), `infrastructure/services` (1), and `domain/{value-objects,entities,errors}` (4). Breadth of import = it is the canonical way every layer signals "bad input."

**Evidence it is a type, not coupled behavior:**
- Every consumer **imports it from `domain/errors`** and either `throw`s it or `instanceof`-checks it. All dependency arrows point **inward toward the domain** — the correct Clean-Architecture direction.
- The flagged "ACN auth middleware" is actually **`api/middleware/errorHandler.ts`** (L5 import, L70–71 `if (err instanceof ValidationError)` → HTTP 400). That is the presentation/adapter ring correctly translating a domain error to a transport status. It is not auth, and not a leak — it is the textbook role of an error-mapping adapter.
- The "Knex repo" reach is **not** an actual repository import: no file under `infrastructure/database/repositories` imports it. The bridge to that community is `infrastructure/config/ConfigurationValidator.ts` (fail-fast config validation) — still an outer layer *throwing inward*, fine.
- `ValidationError.ts` itself imports **only** `DomainError`. It carries **no** auth, engine, or persistence behavior. There is nothing to couple.

A shared-kernel error type used pervasively across rings — with all dependencies pointing inward and the lone middleware edge being legitimate transport translation — is exactly what Clean Architecture *wants*. The graph paints it as a suspicious bridge only because betweenness centrality is high for any widely-thrown error. **Severity: NONE.**

---

## Summary

- **Genuine SRP violations: 0.** (ExportBundleBuilder is a PARTIAL/LOW smell — a store + import-time GC timer riding on the builder — worth a small split but not a god-component.)
- **Graph artifacts (low cohesion is benign): 3** — Dashboard Container (multi-component + styles container), Backend Validation (leaf domain type with scattered consumers), ValidationError bridge (correct inward-pointing shared kernel).
- **Net:** Separation of concerns holds across the flagged set; the only actionable item is the LOW-severity lifecycle/timer extraction in `ExportBundleBuilder.ts`. The deeper coupling in that file (concrete infra reaches) is a DIP issue already captured in `nomad-dip-violations.md`, not an SRP defect.
