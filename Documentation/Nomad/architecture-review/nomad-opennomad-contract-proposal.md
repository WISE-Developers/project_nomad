# openNomad Contract Remediation Proposal — `IOpenNomadAPI`

**Date:** 2026-06-17
**Scope:** Read-only survey + design proposal. No source modified.
**Subject:** `IOpenNomadAPI` LSP violation — reference adapter throws "not implemented" on methods the contract declares mandatory.
**Repo:** `frontend/` (Project Nomad)

---

## 1. Survey — what's actually there

### 1.1 The contract

`IOpenNomadAPI` is defined at `src/openNomad/api.ts:655`. It is a single flat interface with two top-level methods plus six namespaced module objects. It is the **public integration seam**: agencies implement it, `OpenNomadProvider` accepts it, and the future data service plugs in here. Changing its shape is potentially a breaking change for every external implementer.

**Top-level:**
- `fetch(url, init?): Promise<Response>` — `api.ts:669`
- `getBaseUrl(): string` — `api.ts:678`

**`auth` module** (`api.ts:690`)
- `getCurrentUser(): Promise<User | null>` — `:696`
- `getAuthToken(): Promise<string | null>` — `:706`
- `onAuthChange(cb): Unsubscribe` — `:714`

**`models` module** (`api.ts:724`)
- `create(params): Promise<Model>` — `:731`
- `list(filter?, pagination?): Promise<PaginatedResponse<Model>>` — `:740`
- `get(id): Promise<Model>` — `:749`
- `update(id, updates): Promise<Model>` — `:760`
- `delete(id): Promise<void>` — `:768`
- `getStatus(id): Promise<ModelStatus>` — `:776`

**`jobs` module** (`api.ts:786`)
- `submit(modelId): Promise<JobSubmitResponse>` — `:795`
- `cancel(jobId): Promise<void>` — `:804`
- `getStatus(jobId): Promise<JobStatusDetail>` — `:812`
- `onStatusChange(jobId, cb): Unsubscribe` — `:823`

**`results` module** (`api.ts:833`)
- `get(modelId): Promise<ModelResults>` — `:841`
- `getData(resultId): Promise<GeoJSONGeometry | string>` — `:849`
- `export(modelId, params): Promise<Blob>` — `:858`
- `getExportFormats(): Promise<ExportFormat[]>` — `:865`
- `getModelResultsUrl(modelId): string` — `:880`
- `getPreviewUrl(resultId): string` — `:891`
- `transformPreviewUrl?(url): string` — `:906` *(already optional)*
- `getDownloadUrl(resultId): string` — `:914`
- `getTileUrlTemplate(resultId): string` — `:925`
- `getTileBounds(resultId): Promise<BBox>` — `:935`

**`spatial` module** (`api.ts:955`) — **flat object mixing two concerns** (the comments at `:957` "Map Interaction (Host-Provided in ACN Mode)" and `:1051` "Data Services" already mark the seam):
- *Map interaction:* `drawPoint()` `:969`, `drawLine()` `:980`, `drawPolygon()` `:991`, `onGeometryChange(cb)` `:1002`, `cancelDraw()` `:1009`, `addLayer(layer)` `:1018`, `updateLayer(id, updates)` `:1026`, `removeLayer(id)` `:1033`, `fitBounds(bounds, opts?)` `:1041`, `getBounds(): BBox` `:1048`
- *Data services:* `getWeatherStations(bounds)` `:1060`, `getFuelTypes(bounds)` `:1068`, `getElevation(bounds)` `:1076`

**`config` module** (`api.ts:1086`)
- `getAvailableEngines(): Promise<Engine[]>` — `:1092`
- `getAgencyConfig(): Promise<AgencyConfig>` — `:1102`

### 1.2 Reference impl — `DefaultOpenNomadAPI.ts`

**9 methods hard-throw `"not implemented"` (the LSP violation):**

| Method | Module | file:line |
|---|---|---|
| `create` | models | `DefaultOpenNomadAPI.ts:345` |
| `update` | models | `:421` |
| `submit` | jobs | `:477` |
| `cancel` | jobs | `:491` |
| `getData` | results | `:631` |
| `export` | results | `:643` |
| `drawPoint` | spatial/map | `:778` |
| `drawLine` | spatial/map | `:792` |
| `drawPolygon` | spatial/map | `:806` |

(Throws at `:615` and `:738` are HTTP error handling, **not** contract gaps — excluded.)

**The remaining ~28 methods are real**, but the spatial/map mutators degrade silently rather than throw — a *second*, subtler LSP issue:
- `addLayer` — `console.warn` + no-op (`:843`)
- `updateLayer` `:857`, `removeLayer` `:868`, `fitBounds` `:879`, `cancelDraw` `:832` — silent no-ops
- `getBounds` `:890` — returns world bounds `[-180,-90,180,90]`
- `getWeatherStations` `:906` → `[]`, `getFuelTypes` `:919` → stub, `getElevation` `:941` → stub data

So the default adapter has **three distinct compliance tiers**: real, throws-loudly (9), and degrades-silently (~8). The contract's type signature cannot distinguish any of them — every method looks equally mandatory.

### 1.3 Second adapter — `ExampleAgencyAdapter.ts`

This is a template ("Copy this file as a starting point", `:1-7`). It implements `IOpenNomadAPI` **fresh** (imports types only, `:10-33`; does **not** extend `DefaultOpenNomadAPI`). It implements the full surface but the spatial-map methods are themselves stubs that throw `"must be implemented by your agency adapter"` (e.g. `drawPoint` `:365-369`) or `// TODO` no-ops (`addLayer` `:400-404`). So the proof-of-coexistence adapter **also** cannot satisfy the map methods without a real host map — confirming these are genuinely host-provided, not adapter-provided.

### 1.4 How consumers obtain the API

`OpenNomadContext.tsx` — `OpenNomadProvider({ adapter, children })` at `:93` stores the adapter in a React context typed `IOpenNomadAPI | null` (`:31`). `useOpenNomad()` (`:152`) returns it (throws if no provider). `useOpenNomadOptional()` (`:186`) returns `IOpenNomadAPI | null`.

**"Host-provided" in practice:** in ACN/embedded mode the host app supplies an adapter whose map methods delegate to the host's own MapLibre/Mapbox instance. In SAN mode there is no host map at adapter-construction time, so `DefaultOpenNomadAPI` cannot implement them — hence the throws. The seam is real; the type system just doesn't model it.

### 1.5 Existing tests (`__tests__/DefaultOpenNomadAPI.test.ts`)

Only **one** throwing method is pinned: `create` → `rejects.toThrow('create() is not implemented')` (`:240-254`). The silent-degrade behaviors that *are* pinned: `getWeatherStations` → `toEqual([])` (`:380-382`) and `getFuelTypes` → stub (`:386-397`). The other 8 throwing methods (`update`, `submit`, `cancel`, `getData`, `export`, `drawPoint/Line/Polygon`) are **unpinned** — no characterization coverage.

---

## 2. Proposed design

### 2.1 The mandatory-vs-host split

Justified directly from how both adapters behave (§1.2–1.3):

**MANDATORY core** — every adapter (SAN and ACN) implements with real behavior; both adapters do so today:
`fetch`, `getBaseUrl`; `auth.*`; `models.list/get/delete/getStatus`; `jobs.getStatus/onStatusChange`; `results.get/getExportFormats/getModelResultsUrl/getPreviewUrl/getDownloadUrl/getTileUrlTemplate/getTileBounds`; `config.getAvailableEngines/getAgencyConfig`.

**OPTIONAL — backend-capability** (a backend MAY support; default throws because the Nomad backend uses an atomic run, not separate CRUD):
`models.create`, `models.update`, `jobs.submit`, `jobs.cancel`, `results.getData`, `results.export`.

**HOST-PROVIDED — map-interaction** (only meaningful when a host map exists; SAN has none):
`spatial.map`: `drawPoint`, `drawLine`, `drawPolygon`, `onGeometryChange`, `cancelDraw`, `addLayer`, `updateLayer`, `removeLayer`, `fitBounds`, `getBounds`.

**MANDATORY data-services** (queryable headlessly; default returns empty/stub but the *signature* is honourable):
`spatial.data`: `getWeatherStations`, `getFuelTypes`, `getElevation`.

This is exactly the boundary the source comments already drew at `api.ts:957` and `:1051`, and the tier boundary the default adapter's behavior reveals.

### 2.2 Type-level expression (compile-error, not runtime-throw)

Split the monolith into a **required core interface** + **optional capability interfaces**, and split `spatial` into `spatial.data` (required) + `spatial.map` (optional). Capabilities a SAN adapter can't honour become **optional (`?`)** so a half-implemented adapter that omits them is *correct by construction*, and a consumer must feature-detect before calling.

```ts
// ---- Required core every adapter MUST implement ----
interface SpatialDataAPI {
  getWeatherStations(bounds: BBox): Promise<WeatherStation[]>;
  getFuelTypes(bounds: BBox): Promise<FuelTypeData>;
  getElevation(bounds: BBox): Promise<ElevationData>;
}

interface OpenNomadCore {
  fetch(url: string, init?: RequestInit): Promise<Response>;
  getBaseUrl(): string;
  auth: AuthAPI;                 // getCurrentUser, getAuthToken, onAuthChange
  models: ModelsCoreAPI;         // list, get, delete, getStatus
  jobs: JobsCoreAPI;             // getStatus, onStatusChange
  results: ResultsCoreAPI;       // get, getExportFormats, *Url*, getTileBounds
  config: ConfigAPI;             // getAvailableEngines, getAgencyConfig
  spatial: { data: SpatialDataAPI; map?: SpatialMapAPI };
}

// ---- Optional capability interfaces ----
interface ModelCrudCapability   { create(p: ModelCreateParams): Promise<Model>;
                                   update(id: string, u: Partial<ModelCreateParams>): Promise<Model>; }
interface JobControlCapability   { submit(modelId: string): Promise<JobSubmitResponse>;
                                   cancel(jobId: string): Promise<void>; }
interface ResultDataCapability   { getData(resultId: string): Promise<GeoJSONGeometry | string>;
                                   export(modelId: string, p: ExportParams): Promise<Blob>; }

interface SpatialMapAPI {        // host-provided; entire object optional
  drawPoint(): Promise<GeoJSON.Point>;
  drawLine(): Promise<GeoJSON.LineString>;
  drawPolygon(): Promise<GeoJSON.Polygon>;
  onGeometryChange(cb: (g: GeoJSONGeometry | null) => void): Unsubscribe;
  cancelDraw(): void;
  addLayer(l: MapLayer): void;
  updateLayer(id: string, u: Partial<MapLayer>): void;
  removeLayer(id: string): void;
  fitBounds(b: BBox, opts?: { padding?: number; animate?: boolean }): void;
  getBounds(): BBox;
}

// Optional capabilities fold into the module objects:
interface ModelsCoreAPI extends Partial<ModelCrudCapability> {
  list(...): Promise<PaginatedResponse<Model>>;
  get(id: string): Promise<Model>;
  delete(id: string): Promise<void>;
  getStatus(id: string): Promise<ModelStatus>;
}
// jobs / results follow the same Core + Partial<Capability> pattern.

type IOpenNomadAPI = OpenNomadCore;
```

**Why this kills the runtime throw:** if `models.create` is optional (`create?`), an adapter that can't do it simply omits it — the compiler accepts the adapter, and consumers must write `if (api.models.create) ...` (or call a typed `hasCapability()` helper). The "not implemented" `throw` disappears because the absent method is now *expressible*. A consumer calling a guaranteed core method (`models.list`) still gets full type safety with no guard.

**Consumer-side feature detection** (replaces try/catch-on-throw):
```ts
const api = useOpenNomad();
if (api.spatial.map) { await api.spatial.map.drawPoint(); }
else { /* SAN fallback: TerraDraw / built-in tool */ }
```

### 2.3 Backward-compatibility analysis

**This is a breaking change for external implementers** because:
1. Moving `spatial.draw*`/`addLayer`/... under `spatial.map.*` is a structural rename — every existing call site and adapter property moves one level deeper.
2. `ExampleAgencyAdapter` and any real agency adapter implement the *flat* `spatial` shape; they would fail to compile against the nested shape.

**Recommended path — phased, minimally breaking:**

- **Phase A (NON-breaking): make optional capabilities optional in place.** Change `create`, `update`, `submit`, `cancel`, `getData`, `export` to optional (`?`) on the *existing flat* modules. This is **source-compatible** — existing adapters that *do* implement them still satisfy the type; `DefaultOpenNomadAPI` can drop the 6 throwing method bodies entirely and just omit them. Consumers gain compile-time nudges to feature-detect. No structural move. Ship this first; it removes 6 of the 9 throws with zero break.

- **Phase B (breaking, versioned): introduce `spatial: { data; map? }`.** This is the structural move and the only genuinely breaking part. Gate it behind a **major version bump** of the openNomad package. Provide a **compatibility shim**: ship a `liftFlatSpatial(adapter)` adapter-wrapper that maps a legacy flat `spatial` onto the new nested shape, so existing agencies migrate by wrapping, not rewriting. Keep the flat type exported as `@deprecated IOpenNomadAPILegacy` for one minor cycle.

- **The 3 draw methods** (`drawPoint/Line/Polygon`) — the remaining throws — are resolved by Phase B (they live under optional `spatial.map`). Until Phase B ships they stay as documented throws, now characterization-pinned (§2.4).

**Net:** Phase A is non-breaking and eliminates 6/9 throws immediately. Phase B is breaking but mechanical, version-gated, and shimmed. Prefer landing A now; schedule B with the next major.

### 2.4 Test plan — characterization FIRST

Write these BEFORE touching any code, to pin current observable behavior (TDD red baseline; all should pass against today's source):

**Pin the 9 throwing methods** (only `create` is covered today, `test:240`):
1. `models.create` → `rejects.toThrow('create() is not implemented')` *(exists — keep)*
2. `models.update` → `rejects.toThrow('update() is not implemented')`
3. `jobs.submit` → `rejects.toThrow('submit() is not directly supported')`
4. `jobs.cancel` → `rejects.toThrow('cancel() is not implemented')`
5. `results.getData` → `rejects.toThrow('getData() is not implemented')`
6. `results.export` → `rejects.toThrow('export() is not implemented')`
7. `spatial.drawPoint` → `rejects.toThrow('drawPoint() is not implemented')`
8. `spatial.drawLine` → `rejects.toThrow('drawLine() is not implemented')`
9. `spatial.drawPolygon` → `rejects.toThrow('drawPolygon() is not implemented')`

**Pin the silent-degrade map/data methods** (so refactor preserves behavior):
10. `spatial.getWeatherStations` → `toEqual([])` *(exists, `test:380`)*
11. `spatial.getFuelTypes` → stub shape *(exists, `test:386`)*
12. `spatial.getElevation` → stub shape *(add)*
13. `spatial.getBounds` → `[-180,-90,180,90]` (`DefaultOpenNomadAPI.ts:890`)
14. `spatial.addLayer` → does not throw; emits `console.warn` (`:843`)
15. `spatial.updateLayer/removeLayer/fitBounds/cancelDraw` → no-op, no throw

**Pin the real core methods already partly covered:** `models.list/get/delete/getStatus`, `jobs.getStatus/onStatusChange`, `results.get/getExportFormats`, `config.*` (extend existing suite to full core).

**After Phase A refactor:** convert tests 1–6 from "throws" to "method is `undefined` on the default adapter" (`expect(api.models.create).toBeUndefined()`), proving the optional-capability migration. Add a type-level test (e.g. `tsd` or a compile-fixture) asserting a minimal adapter that implements *only* `OpenNomadCore` compiles, and one that omits a core method does NOT.

---

## 3. Summary

- **9** methods hard-throw `"not implemented"`; **~28** are real (≈8 of those silently degrade — a secondary LSP smell).
- **Recommended split:** required `OpenNomadCore` + optional capability interfaces (`ModelCrud`, `JobControl`, `ResultData`) + `spatial.data` (required) / `spatial.map?` (optional, host-provided).
- **Phase A** (mark 6 backend methods optional, in place) is **non-breaking** and removes 6/9 throws now. **Phase B** (`spatial.data`/`spatial.map` split) is **breaking** — version-gate it and ship a flat→nested compatibility shim.
