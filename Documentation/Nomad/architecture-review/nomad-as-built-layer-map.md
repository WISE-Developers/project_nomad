# Nomad As-Built Layer Map (Clean Architecture Review — Step 2)

**Read-only mapping of as-built code to the four intended layers** (Entities → Use Cases → Interface Adapters → Frameworks & Drivers). Yardstick: `nomad-intended-architecture-spec.md`. Node counts from `graphify-out/graph_directed.json` (`source_file` grouped by directory). Test dirs (`__tests__`) folded into their parent for assignment but listed where material.

**Key finding up front:** Unlike what the yardstick anticipated (it said no doc maps directories to layers and assumed business rules were "likely inside `services/`"), the **backend is physically laid out as Clean Architecture** — explicit `domain/`, `application/`, `infrastructure/` top-level folders with an `application/interfaces/` seam. This is structural, not doc-stated, so still marked **(inferred)** per the yardstick's rule, but the inference is strong (folder names ARE the layer names).

---

## Backend (`backend/src/`)

| Directory/Module | Assigned Layer | explicit/inferred | nodes | Justification |
|---|---|---|---|---|
| `domain/entities` | Entities | inferred (strong) | 98 | Folder named for layer; enterprise objects. No infra/express imports found. |
| `domain/value-objects` | Entities | inferred (strong) | 77 | `Coordinates`, `BoundingBox`, `FWIIndices`, `TimeRange` — pure VOs. |
| `domain/errors` | Entities | inferred (strong) | 41 | Domain error types, framework-free. |
| `application/use-cases` | Use Cases | inferred (strong) | 7 | `UseCase.ts` base + index; literal use-case layer. |
| `application/interfaces` | Use Cases (ports) | inferred (strong) | 70 | Port interfaces (`IJobRepository`, `IModelExecutionService`, `IFireModelingEngine`) — DIP boundary owned by app layer. |
| `application/services` | Use Cases | inferred | 18 | `ModelResultsService` — app orchestration (but see "Won't place"). |
| `application/perimeters` | Use Cases | inferred | 30+13 | Perimeter parse/format logic (GeoJSON/KML/Shapefile) — app rules, not framework. |
| `application/common` | Use Cases | inferred | 5 | `Result.ts` — Result/Either helper for app layer. |
| `api/routes/v1` | Interface Adapters | inferred (strong) | 47+6 | Express controllers; doc-stated `routes/` adapter role. |
| `api/middleware` | Interface Adapters | inferred | 34+3 | Express middleware (request/response adaptation). |
| `api` / `api/__tests__` | Interface Adapters | inferred | 5+18+2 | API wiring. |
| `infrastructure/database` (+`knex`,`migrations`,`repositories`) | Frameworks & Drivers | inferred (strong) | 17+78+35+8 | Knex/SQLite/PostGIS drivers + concrete repos. |
| `infrastructure/docker` | Frameworks & Drivers | inferred (strong) | 14 | Docker socket executor. |
| `infrastructure/execution` / `nativebinary` | Frameworks & Drivers | inferred | 6+13 | Native/Docker execution drivers. |
| `infrastructure/firestarr` | Frameworks & Drivers | inferred | 155+19 | FireSTARR engine integration (largest infra module). |
| `infrastructure/export` | Frameworks & Drivers | inferred | 69+3 | gdal/zip export drivers. |
| `infrastructure/weather` | Frameworks & Drivers | inferred | 26+4 | External weather data drivers. |
| `infrastructure/config` | Frameworks & Drivers | inferred | 51+3 | Env/config loading (fail-fast). |
| `infrastructure/auth` | Frameworks & Drivers | inferred | 7 | File-based auth driver. |
| `infrastructure/logging` | Frameworks & Drivers | inferred | 10 | Logging driver. |
| `infrastructure/services` | Frameworks & Drivers | inferred | 33 | Concrete impls of app ports (`JobQueue`, `ModelExecutionService`). |
| `core/config/schema` | Frameworks & Drivers | inferred | 207 | Config schema (largest single dir; framework/config concern). |
| `core/deployment` | Frameworks & Drivers (composition root) | inferred | 27+3 | `ServiceFactory`/`ServiceRegistry` — DI wiring (composition root). |
| `index.ts` | Frameworks & Drivers | inferred (strong) | (in `.`) | Express bootstrap (doc-stated). |
| `mcp` (+resources,tools) | Interface Adapters | inferred | 21+11+6+4+12 | MCP server = alternate delivery adapter. |
| `services/splash` | Frameworks & Drivers | inferred | 9+3 | Splash file/path asset handling — I/O. |
| `shared` | cross-cutting | inferred | 3+9 | Shared utils, no single layer. |
| `types` | cross-cutting | inferred | 16 | Type decls, no single layer. |

**Backend module counts by layer:** Entities **3**, Use Cases **5**, Interface Adapters **5** (api, middleware, api-root, mcp, + routes folded), Frameworks & Drivers **~14**, cross-cutting **2**.

---

## Frontend (`frontend/src/`)

The frontend is organized **by feature**, NOT by Clean Architecture layer. Mapping is a best-effort overlay.

| Directory/Module | Assigned Layer | explicit/inferred | nodes | Justification |
|---|---|---|---|---|
| `openNomad` (api.ts, index.ts) | Interface Adapters | explicit (doc-backed) | 38 | `IOpenNomadAPI` seam — the docs' named adapter abstraction. |
| `openNomad/default` | Interface Adapters | explicit | 8 | `DefaultOpenNomadAPI` (SAN reference adapter), doc-stated. |
| `openNomad/context` | Interface Adapters | explicit | 14 | `OpenNomadProvider` injecting the adapter (DIP seam). |
| `openNomad/customization` | Interface Adapters | inferred | 58 | Agency customization of the adapter surface. |
| `openNomad/examples` | Interface Adapters (examples) | inferred | 12 | Sample agency adapters. |
| `features/Map/*` | Frameworks & Drivers | inferred (strong) | 80+38+25+10+32+18 | MapBox/MapLibre GL render layer (doc-stated outermost). |
| `features/Dashboard/*` | Frameworks & Drivers | inferred | 146+23+31+6 | React Dashboard UI + its hooks/context. |
| `features/ModelSetup/*` (+steps,validators) | Frameworks & Drivers | inferred | 124+81+10+28+26+7 | Wizard UI; validators are app-rule-ish but live in UI feature. |
| `features/ModelReview/*` | Frameworks & Drivers | inferred | 82+9+13+8 | Results review UI. |
| `features/Export/*` | Frameworks & Drivers | inferred | 18+3+9 | Export UI. |
| `features/Wizard/*` | Frameworks & Drivers | inferred | 19+8+4+14 | Wizard UI/context. |
| `features/Settings`, `features/Notifications/*` | Frameworks & Drivers | inferred | 17, 15+6 | UI features. |
| `components` (top-level) | Frameworks & Drivers | inferred | 31 | Splash/About modals — shared UI. |
| `core/deployment` | Frameworks & Drivers | inferred | 13 | `DeploymentModeContext` — React context for SAN/ACN mode. |
| `services` (api.ts, authClient.ts, serviceWorker.ts) | Interface Adapters / Frameworks | inferred (mixed) | 36 | HTTP/auth/service-worker clients — gateway-ish but framework-coupled. |
| `hooks` (top-level) | Frameworks & Drivers | inferred | 9 | `useAuth`, `useSplash` — React hooks. |
| `shared/utils` | cross-cutting | inferred | 26 | Shared utilities. |
| `test`, `test/mocks` | test | n/a | 1+10 | Test scaffolding. |

**Frontend module counts by layer:** Entities **0**, Use Cases **0** (no app-rule layer; logic lives in feature hooks/validators), Interface Adapters **~6** (all `openNomad/*` + part of `services`), Frameworks & Drivers **~15** (all `features/*` + components + hooks + core), cross-cutting **1**.

---

## "Won't cleanly place" section

- **`application/services/ModelResultsService.ts`** — sits in the Use-Cases layer but **imports concretely from `infrastructure/`** (grep confirmed). That is a Dependency-Rule violation: an inner layer reaching outward. Straddles Use Cases ↔ Frameworks.
- **`application/interfaces/IFireModelingEngine.ts` and `INotificationPreferencesRepository.ts`** — port interfaces that **reference `infrastructure` in their text** (likely importing infra types into the port definition). A port should be infra-free; straddles Use Cases ↔ Frameworks.
- **`infrastructure/services/`** — concrete implementations (`JobQueue`, `ModelExecutionService`) of `application/interfaces` ports. Correctly placed as Frameworks, but the **duplicate `services/` name** in both `application/` and `infrastructure/` invites confusion about which is the use case vs the driver.
- **`backend/src/services/splash/`** — a third top-level `services/` directory outside both `application/` and `infrastructure/`. Naming collision; doesn't belong to the layered tree at all. Straddles nothing but breaks the otherwise-clean top-level layout.
- **`core/config/schema` (207 nodes)** — by far the largest single module; config schema. Ambiguous between Frameworks (config loading) and a cross-cutting concern. Placed in Frameworks.
- **`core/deployment` (ServiceFactory/ServiceRegistry)** — the composition root (DI). Clean Architecture puts this in the outermost ring (Main/Frameworks), but its name `core/` falsely implies an inner layer.
- **Frontend `features/ModelSetup/validators/` and `features/*/hooks/`** — contain genuine **application-rule logic** (validation, orchestration) embedded inside UI features. There is no Use-Cases or Entities layer on the frontend, so business rules are physically fused into the Frameworks layer. Straddles Use Cases ↔ Frameworks.
- **Frontend `services/`** — `api.ts` (gateway, Adapter) sits beside `serviceWorker.ts` (pure framework). Mixed-concern folder.
- **`mcp/`** — alternate delivery mechanism (MCP server). Adapter-like but contains its own resources/tools/knowledge; reasonable as Interface Adapters but not anticipated by the yardstick.

---

## Does the on-disk structure resemble layered architecture?

**Backend: YES — strongly.** Top-level `backend/src/` is `domain/`, `application/`, `infrastructure/`, `api/`, `core/` — a near-textbook Clean Architecture skeleton with an explicit `application/interfaces/` port layer for DIP. The domain layer is framework-free (verified: no express/knex/infrastructure imports). The main defects are (a) a few inner-layer→infrastructure leaks in `application/`, and (b) three competing `services/` directories across different layers. The yardstick's assumption that business rules were buried in `services/` is **outdated** — the backend has since been refactored into named layers.

**Frontend: NO — it is organized by feature, by type within feature.** `frontend/src/features/{Map,Dashboard,ModelSetup,ModelReview,Export,Wizard,Settings,Notifications}` with `components/hooks/context/types/utils` under each. The only Clean-Architecture-style seam is `openNomad/` (the doc-stated `IOpenNomadAPI` adapter). There is no Entities or Use-Cases layer; domain/application logic lives inside feature hooks, validators, and utils — fused into the UI (Frameworks) ring.

**Verdict:** The repo is **architecturally split** — the backend is physically structured as Clean Architecture layers; the frontend is structured by feature with a single doc-mandated adapter seam (`openNomad`).
