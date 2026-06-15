# Project Nomad — Intended Architecture Yardstick

**Purpose:** Establish what Nomad's architecture is *supposed* to look like, distilled from the project's own design docs and Symbiosis standards, so a later SOLID + Clean Architecture compliance review can measure the as-built code against *intended* design rather than a generic ideal.

**Sources read:**
- `projects/project_nomad/Documentation/Nomad/ARCHITECTURE.md` (the as-built/intended system architecture)
- `projects/project_nomad/original_draft_spec.md` (original spec)
- `projects/project_nomad/NOMAD_REQUIREMENTS.md`, `FIRESTARR_REQUIREMENTS.md` (system reqs)
- `projects/project_nomad/frontend/src/openNomad/README.md` (openNomad integration guide)
- `Documentation/persist/best_practices/development/development_workflow.md` (Symbiosis dev standards — the only doc stating Clean Architecture layers)

> **Critical framing note:** The *named* Clean Architecture layer model is stated ONLY in the workspace standard (`development_workflow.md`), as a cross-project mandate. Nomad's own `ARCHITECTURE.md` describes a **technical/service architecture** (Docker services, routes/services/db) and does **not** name Entities / Use-Cases / Interface-Adapters / Frameworks layers, nor map directories to them. The yardstick below therefore *combines* the standard's mandated layers with Nomad's actual module layout. Where the mapping is not stated by any doc, it is marked **[INFERRED]**.

---

## 1. Intended Layers

The mandated layer model (`development_workflow.md > Development Architecture > Uncle Bob's Clean Architecture`), quoted:

> "Frameworks & Drivers (Express, React, SQLite, external services) → Interface Adapters (Controllers, Presenters, Gateways) → Application Business Rules (Use Cases) → Enterprise Business Rules (Entities)"

Mapping to Nomad modules (frontend AND backend). **Doc-stated directories** come from `ARCHITECTURE.md > File Layout (Actual)` and the live `frontend/src` tree; layer *assignments* are **[INFERRED]** unless quoted, because no Nomad doc assigns directories to layers.

| Clean layer | Backend (`backend/src/`) | Frontend (`frontend/src/`) |
|---|---|---|
| **Entities** (enterprise rules) | **[INFERRED]** — no dedicated `domain/`/`entities/` dir documented | **[INFERRED]** — none documented |
| **Use Cases** (app rules) | **[INFERRED]** — likely inside `services/` (mixed with infra today) | **[INFERRED]** — likely inside `features/` logic + hooks |
| **Interface Adapters** (controllers, gateways) | `routes/` (doc-stated); `services/` adapters e.g. `DockerExecutor.ts`, `NativeExecutor.ts` (doc-stated as services) | `openNomad/` adapter layer — `DefaultOpenNomadAPI.ts`, agency adapters implementing `IOpenNomadAPI`; `openNomad/context/` provider |
| **Frameworks & Drivers** (outermost) | `index.ts` (Express bootstrap), `db/` (Knex connection + migrations), Docker socket, gdal-async, cffdrs | `App.tsx`, MapBox GL, React render layer, `features/Map`, `features/Dashboard`, `features/Wizard`, `features/Settings` |

Nomad service topology (`ARCHITECTURE.md > Service Architecture`): three Docker services — `nomad-frontend` (Nginx), `nomad-backend` (Express 4.21, port 3001), and `firestarr-app` (spawned per job by `DockerExecutor` via mounted Docker socket). This is deployment topology, NOT Clean Architecture layering — do not conflate.

---

## 2. Dependency Rules

Stated mandate (`development_workflow.md`), quoted:

> "Dependencies point inward - outer layers depend on inner layers, never the reverse."
> "**The Dependency Rule** - Source code dependencies must point inward. Nothing in an inner circle can know about something in an outer circle."
> "When the database changes, only the outer layer changes. When the UI framework changes, business logic is untouched. The core is protected."

Applied to Nomad (the review's measuring stick):
- `routes/` and `openNomad/` adapters MAY depend on use-cases/entities; entities/use-cases must NEVER import Express, Knex, MapBox, React, Docker, or `openNomad` adapter types.
- `db/` (Knex), `DockerExecutor`/`NativeExecutor`, gdal-async are Frameworks — business rules must NOT depend on them directly; dependency must invert through an abstraction (see §3).
- Frontend `features/*` (React/MapBox) is outermost; it must NOT be depended on by adapter/business logic.

> **Doc clarity verdict:** The dependency *direction* rule is stated **clearly and emphatically** — but only generically in the workspace standard. Nomad's own docs **do not restate or specialize it**, and provide no enforcement mechanism (no lint boundary rules, no documented allowed-import matrix). So the *rule* is clear; its *Nomad-specific application* is **vague/unstated**.

---

## 3. Key Seams / Abstractions

1. **`IOpenNomadAPI`** (`openNomad/README.md > Overview`) — the primary documented seam. Quoted:
   > "The openNomad API is an abstraction layer that allows the Dashboard component to communicate with any backend. Your agency creates an adapter that implements the `IOpenNomadAPI` interface."
   - **Abstracts:** all backend communication (auth, data, jobs, spatial, results, config).
   - **Six modules** (`README > Implementing the Adapter`): `auth`, `models`, `jobs`, `results`, `spatial`, `config` — a deliberately *segregated* interface (ISP-aligned).
   - **Who depends on abstraction:** the `Dashboard`/`DashboardContainer` consumes `IOpenNomadAPI` via `OpenNomadProvider` (React context). It depends on the *interface*, never a concrete backend.
   - **Who provides concretion:** SAN ships `DefaultOpenNomadAPI.ts` (`README > Reference Implementation`: "the complete SAN mode implementation … template for agency adapters"); ACN agencies write their own adapter. This is textbook DIP at the frontend↔backend seam.

2. **Engine abstraction (`IFireModelingEngine` / WiseGuy)** — named in workspace `CLAUDE.md` (`User Code → EngineManager → FireModelingEngine Interface → Specific Engine`) and `config.getAvailableEngines()` returning `firestarr` in the openNomad README test. **NOTE/CONFLICT:** auto-memory states **"WISE is abandoned. FireSTARR only."** so the WiseGuy multi-engine abstraction may be vestigial. Backend `DockerExecutor` vs `NativeExecutor` (`ARCHITECTURE.md`) is the de-facto engine-execution seam — **[INFERRED]** whether a formal backend engine interface exists; the docs do not name one.

3. **Repository / persistence seam** — **[INFERRED / GAP]**. Knex is documented as the unifying query layer ("Knex provides a consistent query interface across both modes" — `ARCHITECTURE.md > Database Layer`), but **no repository interface** is named. Knex itself is the only stated abstraction over SQLite vs PostGIS.

---

## 4. SAN vs ACN

From `original_draft_spec.md` and `ARCHITECTURE.md`:

| Concern | SAN (Stand Alone) | ACN (Agency Centric) |
|---|---|---|
| Spatial DB | **SpatiaLite/SQLite** (spec); SQLite via better-sqlite3 + Knex (ARCHITECTURE.md) | **PostGIS** via Knex (ARCHITECTURE.md); "PostGIS/GeoServer integration" (spec) |
| Auth | "Simple file-based authentication" (spec) / "simple username auth" (ARCHITECTURE.md) | "auth deferred to the host application" (ARCHITECTURE.md) |
| Packaging | Self-contained Docker Compose stack + PWA, bundled MapBox host | Component integrated into agency systems; embedded `DashboardContainer mode="embedded"` |
| Backend adapter | `DefaultOpenNomadAPI` shipped | Agency-written `IOpenNomadAPI` adapter |
| Stated priority | **"SAN-first application"** (`ARCHITECTURE.md > Deployment Overview`) — primary mode | secondary/integration mode |

> **CONFLICT to flag:** `original_draft_spec.md` says SAN uses **SpatiaLite**; `ARCHITECTURE.md` says SAN uses **SQLite via better-sqlite3** (no SpatiaLite mention). The review should treat as-built SQLite/Knex as current truth and the SpatiaLite spec as stale, but note the divergence rather than silently resolving it.

---

## 5. Explicit Design Principles Stated in Docs

- **SOLID** (`development_workflow.md > Development Principles > SOLID Principles`) — all five stated verbatim, incl.:
  > "**I**nterface Segregation — Many specific interfaces over one general-purpose interface" and "**D**ependency Inversion — Depend on abstractions, not concretions."
- **The Dependency Rule** — quoted in §2 (`development_workflow.md`).
- **Separation of concerns** — "The architecture separates concerns into concentric layers" (`development_workflow.md`).
- **Simplicity over abstraction** (`development_workflow.md > Papa's Development Principles`): "Three similar lines of code is better than a premature helper function. Don't over-engineer." — tempers dogmatic layering; the review must weigh *over*-abstraction as a violation too.
- **Fail-fast configuration** (same): "No fallback defaults for configuration. If a required env var is missing, crash immediately." (Reinforced by `.claude/CLAUDE.md`.)
- **openNomad ISP-by-design** — the 6-module split of `IOpenNomadAPI` is the docs' concrete ISP/DIP exemplar (`README`).

---

## 6. Gaps (what the review needs that docs DON'T specify)

1. **No directory→layer map in Nomad's own docs.** Only the workspace standard names layers; Nomad never assigns `routes/`/`services/`/`db/`/`features/` to Entities/Use-Cases/etc. Layer assignment is inference.
2. **No named domain/entities or use-case layer** on either backend or frontend in the documented file layout. Business rules' intended home is unspecified.
3. **No repository interface** abstracting persistence; Knex is the only stated seam. DIP at the DB boundary is undefined.
4. **No backend engine interface** is documented (frontend has `config.getAvailableEngines`; backend has `DockerExecutor`/`NativeExecutor` concretes). WiseGuy `IFireModelingEngine` may be legacy/abandoned per auto-memory.
5. **No enforcement mechanism** documented — no lint import-boundary config, no allowed-import matrix, no ADなど. Compliance is aspirational, not gated.
6. **Stale-doc conflicts:** SpatiaLite (spec) vs SQLite/better-sqlite3 (ARCHITECTURE.md); WISE-as-engine (spec/CLAUDE.md) vs "FireSTARR only" (auto-memory).
7. **Presenters layer unmentioned** — Clean Architecture names Presenters; no Nomad analog is documented (React components likely fill the role — [INFERRED]).
