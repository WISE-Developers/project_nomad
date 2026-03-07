# Findings: Results Panel Divergence Between Nomad (SAN) and OpenNomad (ACN)

**Date:** 2026-03-06
**Investigator:** Sage
**Status:** Investigation only — no fixes applied

---

## Observed Behavior

Two differences were observed between Nomad (SAN/floating mode) and OpenNomad (ACN/embedded mode):

1. **Missing model name**: Nomad shows `mode | type | name | ID` in ResultsSummary tags. OpenNomad shows `mode | type | id` — the model name is absent.
2. **Resize not working**: Nomad results panel is resizable and draggable. OpenNomad results panel is not.

---

## Finding 1: Missing Model Name

### Root Cause: `useModelResults` bypasses the OpenNomad adapter

There are **two separate type systems** for model results that have drifted apart:

| Layer | Type | Name field |
|-------|------|------------|
| Feature (ModelReview) | `ModelResultsResponse` | `modelName: string` (top-level) |
| OpenNomad API | `ModelResults` | `model: Model` where Model has `name: string` (nested) |

**The critical bypass:**

The `useModelResults` hook (`features/ModelReview/hooks/useModelResults.ts:59-89`) does NOT use the adapter's `results.get()` method. Instead it:

1. Gets a raw URL from `api.results.getModelResultsUrl(modelId)` (line 64)
2. Fetches that URL directly via `api.fetch(url)` (line 65)
3. Casts the raw JSON response as `ModelResultsResponse` (line 74)

```
Hook data flow (ACTUAL):
  api.results.getModelResultsUrl(modelId)  →  URL string
  api.fetch(url)                           →  raw JSON
  cast as ModelResultsResponse             →  assumes { modelName, modelId, ... }
```

```
Intended adapter flow (UNUSED):
  api.results.get(modelId)                 →  adapter maps response
  returns ModelResults                     →  { model: { name, ... }, results: [...] }
```

**In SAN mode:** The Nomad backend returns JSON matching the `ModelResultsResponse` shape (with `modelName` at top level), so the cast works.

**In ACN mode:** The agency backend returns data in its own shape. The adapter's `results.get()` method exists to map that shape into `ModelResults`, but it's never called. The raw JSON likely doesn't have `modelName` at the top level, so `modelName` resolves to `undefined`.

### Affected files

- `features/ModelReview/hooks/useModelResults.ts` — The hook that bypasses the adapter
- `features/ModelReview/types/index.ts:100-109` — `ModelResultsResponse` type (feature-internal)
- `openNomad/api.ts:391-405` — `ModelResults` type (adapter contract)
- `openNomad/default/DefaultOpenNomadAPI.ts:606-636` — `results.get()` that IS properly implemented but never called

### Why it matters

The entire point of the OpenNomad adapter pattern is to decouple the feature layer from backend-specific response shapes. The `useModelResults` hook breaks this contract by fetching raw JSON and assuming a specific shape, making it impossible for agency adapters to transform the response.

---

## Finding 2: Resize Not Working in Embedded Mode

### Root Cause: `ModelReviewPanel` unconditionally uses `<Rnd>` regardless of mode

`ModelReviewPanel` (`features/ModelReview/components/ModelReviewPanel.tsx:262-307`) always wraps its content in a `<Rnd>` component from `react-rnd`. It does this regardless of whether the Dashboard is in floating or embedded mode — the panel has no awareness of the current mode.

**How `<Rnd>` works:**
- Renders with `position: absolute` by default
- Uses `bounds="parent"` to constrain drag/resize within the parent element
- Requires the parent to have explicit dimensions and `position: relative` (or similar) for bounds calculation

**In SAN/floating mode:**
The FloatingDashboard renders inside its own `<Rnd>` wrapper (`DashboardContainer.tsx:381-444`) which provides a properly positioned, dimensioned parent. When it switches to ModelReviewPanel (line 346-354), the panel's `<Rnd>` inherits this spatial context. The map container behind it gives plenty of room.

**In ACN/embedded mode:**
The EmbeddedDashboard renders inside a plain `<div>` (`DashboardContainer.tsx:531-546`). When `activeView === 'results'`, line 499-506 returns `<ModelReviewPanel>` directly, bypassing the container div entirely. The panel's `<Rnd>` now has its parent as whatever DOM element the agency wraps around `<DashboardContainer mode="embedded">`.

From the example integrations (`openNomad/examples/EmbeddedIntegration.tsx`):
```tsx
<aside style={{ width: '400px', borderRight: '1px solid #e0e0e0' }}>
  <EmbeddedNomadDashboard ... />
</aside>
```

A `400px` `<aside>` without explicit `position: relative` or defined height breaks Rnd's resize behavior. The Rnd component can't properly calculate bounds, and its absolute positioning may cause it to render outside the flow, appearing broken or non-interactive.

### Why it matters

The DashboardContainer already handles the floating/embedded split correctly for the dashboard list view (Rnd for floating, plain div for embedded). But ModelReviewPanel ignores this architectural pattern and always uses Rnd. In embedded mode, the panel should render as a scrollable inline container, not a floating resizable window.

---

## Architectural Summary

Both issues stem from the same root problem: **the ModelReview feature was built for SAN mode and never properly adapted for ACN mode.**

| Aspect | SAN (Floating) | ACN (Embedded) | Problem |
|--------|----------------|----------------|---------|
| Data flow | Raw fetch matches backend shape | Raw fetch bypasses adapter mapping | Hook should use `results.get()` |
| Layout | `<Rnd>` inside positioned parent | `<Rnd>` inside agency container | Panel should detect mode |

### What needs to change (not implemented — investigation only)

1. **Data flow fix**: `useModelResults` should call `api.results.get(modelId)` instead of raw-fetching `getModelResultsUrl()`. This puts the adapter back in the data pipeline where it belongs.

2. **Layout fix**: `ModelReviewPanel` needs mode awareness. Either:
   - Accept a `mode` prop and conditionally use Rnd (floating) vs plain container (embedded)
   - Or follow the same pattern as `DashboardContainer` with separate `FloatingReviewPanel` / `EmbeddedReviewPanel` components

3. **Type reconciliation**: The `ModelResultsResponse` (feature type) and `ModelResults` (adapter type) should be reconciled so there's a single source of truth for the results shape.

---

## Files Investigated

| File | Purpose |
|------|---------|
| `features/Dashboard/components/DashboardContainer.tsx` | FloatingDashboard vs EmbeddedDashboard routing |
| `features/ModelReview/components/ModelReviewPanel.tsx` | Results panel with unconditional Rnd |
| `features/ModelReview/components/ResultsSummary.tsx` | Displays modelName, engineType, etc. |
| `features/ModelReview/hooks/useModelResults.ts` | Hook that bypasses adapter |
| `features/ModelReview/types/index.ts` | Feature-internal types |
| `features/Dashboard/components/ModelCard.tsx` | Model list card rendering |
| `openNomad/api.ts` | IOpenNomadAPI interface with ModelResults type |
| `openNomad/default/DefaultOpenNomadAPI.ts` | Default adapter with results.get() |
| `openNomad/examples/ExampleAgencyAdapter.ts` | Agency adapter template |
| `openNomad/examples/EmbeddedIntegration.tsx` | Embedded integration examples |
| `openNomad/customization/types.ts` | NomadConfig, NomadSlots types |
