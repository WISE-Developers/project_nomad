# Deliverable A — "Nomad speaks `.ond`" — Design Proposal

**For Nomad team review**
_Status: PROPOSAL · Date: 2026-06-19 · Prepared by Franco Nogarin_

---

## 1. Summary

Deliverable A teaches Nomad to natively read and write the **`.ond`** open dataset standard (see `nomad-ond-standard-v0.1.md`) and to act as a standards-based **OGC data client**. It is a **standalone Nomad feature** — valuable on its own, and a prerequisite for the later (separate) Data Center service.

It is designed as an **additive, opt-in** capability: with the feature disabled, **Nomad behaves exactly as it does today.**

## 2. Goals / non-goals

**Goals**
- Native `.ond` import/export, including backward-compatibility with today's legacy export ZIPs (`model.json`).
- Nomad as a two-way OGC client (consume model-input + display data; publish results).
- A domain model that faithfully represents a `.ond` (landscape → fires → runs).

**Non-goals (Deliverable A)**
- The Data Center service, GeoServer, catalog, or federation (those are Deliverable B).
- Any change to Nomad's existing behaviour when the feature is off.

## 3. The one real domain change: a `Dataset` aggregate

A `.ond` is a genuinely new top-level concept — **one landscape, many fires, many runs** — that does not fit inside a single `FireModel`. We therefore propose a new domain aggregate:

```
Dataset            (= one landscape: DEM + fuels, versionable over time)
  └─ Fire          (an incident on the landscape)
       └─ Run      (a model execution; today's FireModel maps here)
            ├─ outputs
            └─ validations  (+ re-runs linked by lineage)
```

- **`Dataset`** and **`Fire`** are new domain entities; **`Run`** maps onto today's `FireModel`.
- **Lineage** (e.g. a hindcast `derivedFrom` a forecast run) is a first-class relationship.
- This is the **one change that touches the domain layer** — flagged explicitly because it is where team review matters most. (We considered representing a dataset as a flat set of linked `FireModel`s; with three real levels — landscape, fire, run — that mapping is lossy/awkward, so a true aggregate is the honest fit.)

## 4. Capabilities & attachment seams

Derived from a feasibility audit performed against the current source. Verdicts describe *structural* attachment; the **Build** column is the honest effort/risk (they do not track each other).

| # | Capability | Attaches via | Build |
|---|-----------|--------------|-------|
| A1 | `.ond` import (+ legacy ZIP) | additive branch in the existing import path (archive-type detection); legacy path untouched | **M** |
| A2 | `.ond` export | the export-format mechanism — needs a small change to make formats **registerable** rather than a fixed list | **S** |
| A3 | persistent dataset store | a new application-layer port (`IDatasetStore`), sibling to existing artifact gateways; **separate** from the ephemeral export cache | **M** |
| A4 | canonical normalization + raw retention | a versioned, engine-neutral serializer + provenance index; builds on the existing raw/canonical split | **L** |
| A5 | OGC client IN (WCS/WFS/WMS/WMTS) | OGC-backed implementations of existing repository ports, wired through the existing repository **factory layer**, gated by config | **XL** |
| A6 | OGC client OUT (publish) | a new outbound port (`IDatasetPublisher`) | **L** |

**Net:** buildable **additively and dormant-by-default**, with two contained refactors (A2 export registration; A6 new port). The **OGC client (A5) is the real build** — a WCS raster client + CRS reprojection from scratch — and A4 is the hardest *correctness* problem (the canonical schema is the format's conformance contract).

## 5. Dormancy — how "off" stays off

Each attachment is inert unless the feature is configured:

- **A1/A2** — `.ond` handling is reached only when an `.ond` archive is detected / chosen; existing import/export paths are unchanged.
- **A3** — the persistent store is instantiated only when configured; the ephemeral export cache is untouched.
- **A4** — normalization runs only on the `.ond` path.
- **A5** — the OGC-backed repository is returned by the existing repository factory **only when an OGC source is configured**; with no OGC config the factory returns today's repository unchanged (a config-gated branch whose default is byte-identical to current behaviour).
- **A6** — publish is an opt-in capability, feature-detected by callers.

**Acceptance for "additive":** with the feature disabled, Nomad's behaviour is identical to today's — no altered defaults, no UX change.

## 6. Known constraints (not hand-waved)

- **OGC client IN is the cost center** — a real WCS raster client + CRS reprojection. This is where the engineering effort and risk concentrate.
- **Large rasters need streaming** — the current in-memory import limit (~500 MB) will not hold landscape rasters, which are the *normal* case. Streaming import/export is **in-scope work**, not an edge case.
- **The standard needs governance** — its version authority must be decoupled from Nomad's release cycle, or other tools' conformance breaks (see standard §12).

## 7. Scope

| Capability | Deliverable A | Deliverable B (later) |
|------------|--------------|----------------------|
| `.ond` standard + import/export | IN (file-based) | consumes |
| Legacy ZIP compatibility | IN | — |
| `Dataset` aggregate + persistent store | IN | yes |
| Canonical normalization + raw retention | IN | yes |
| OGC client (in/out) | IN | broker + governance |
| GeoServer + OGC services | no | IN |
| Catalog + federation | no | IN (v1.0) |

## 8. Proposed sequence

**Standard → A → B.** Ratify (or at least stabilise) the `.ond` standard draft, then build A against it, then B.

## 9. What we'd like from the team (review points)

1. **The `Dataset` aggregate** (§3) — does the landscape → fire → run model fit Nomad's domain, and how should it relate to `FireModel`?
2. **The extension seams** (§4) — are the proposed attachment points the right ones, and is the A2 export-registration change acceptable?
3. **The dormancy approach** (§5) — does the config-gated factory branch for A5 satisfy "off stays off"?
4. **Streaming** (§6) — preferred approach for large-raster import/export.
5. **Scope/sequence** (§7–§8) — agreement on MVP boundary and the standard-first order.

## 10. Open questions

- `Dataset` aggregate vs `FireModel`: exact relationship and persistence/migration approach.
- Metadata home: file-manifest-only (portable) vs an additive DB migration for queryable bounds/lineage.
- OGC scope for the first cut: client-IN before publish? Publish profile (e.g. GeoServer REST vs WFS-T/WCS-T)?

---

_Companion documents: `nomad-data-center-team-briefing.html` (overview) and `nomad-ond-standard-v0.1.md` (the format spec)._
