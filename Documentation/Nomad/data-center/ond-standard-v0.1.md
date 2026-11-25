# The Open Nomad Dataset (`.ond`) Standard

**Draft v0.1 — for Nomad team review**
_Status: DRAFT (proposed). Not ratified. The reference implementation will track this draft until ratification at v1.0._
_Date: 2026-06-19 · Prepared by Franco Nogarin_

---

## <a name="one"></a> 1. Status & purpose

This document specifies the **Open Nomad Dataset** format (`.ond`): a portable, single-file, open-format container for everything a fire-behaviour modelling effort needs over a geographic area — terrain, fuels, the fires on that area, the model runs, their outputs, and their validations against reality.

`.ond` is an **interchange standard**. Its goal is that *any conformant tool* — not only Nomad or FireSTARR — can read and write it. Nomad's `.ond` support is defined as **conformance to this standard**, not the other way around.

This is a draft for review. Sections marked **[TBD-v1.0]** are deliberately open and are flagged for team input.

## <a name="two"></a> 2. Design principles

1. **Open formats only.** Contents are standard spatial files (GeoTIFF, GeoJSON, …) that any GIS can open. No proprietary encodings.
2. **Lossless.** Normalization is additive: a canonical representation is derived for interoperability, **and the raw original is retained verbatim**. Nothing is discarded.
3. **Auditable provenance.** Every canonical artifact maps back to its original(s) via a provenance index in the manifest.
4. **Interchange-first.** "Lossless" means *a foreign conformant reader* can reconstruct the dataset and its provenance — not merely that the producer can re-read its own output.
5. **Versioned & governed.** The standard is versioned; its version authority is **decoupled from any single implementation's release cycle**.
6. **Progressive.** A dataset may carry only the essentials or the full record; both are valid (see [§10](#ten)).

## <a name="three"></a> 3. Terminology

| Term | Meaning |
|------|---------|
| **Landscape** | The geographic modelling area. The top-level unit of a `.ond`. Defined by slow-changing inputs (DEM, fuels). |
| **Fire** | An individual fire/incident occurring on the landscape. A landscape may hold many. |
| **Run** | A single model execution for a fire, by a named engine, at a point in time. |
| **Model** | Synonym for a run's configuration + execution. A fire may have many. |
| **Re-run** | A run derived from another (e.g. a hindcast using actual weather), linked to its parent via lineage. |
| **Canonical form** | The normalized, schema-conformant representation of an input. |
| **Original** | The raw source artifact, retained verbatim alongside its canonical form. |
| **Conformant reader/writer** | A tool that fully honours this standard (see [§11](#eleven)). |

## <a name="four"></a> 4. Container

- A `.ond` file is a **ZIP archive** with the extension `.ond`.
- It MUST contain a single root **`manifest.json`** ([§6](#six)).
- All other content lives in folders ([§5](#five)). There are no other files at the archive root.

## <a name="five"></a> 5. Directory structure

```
<landscape-name>.ond
├─ manifest.json                       # the only root file
├─ inputs/                             # the LANDSCAPE — slow-changing
│   ├─ dem/                            # elevation (and derived slope/aspect, if carried)
│   └─ fuels/                          # fuel grid(s)
└─ fires/                              # zero or more fires on this landscape
    └─ <fire-id>/
        └─ runs/
            └─ <engine>/               # e.g. firestarr
                └─ <YYYY-MM-DDThhZ>/   # one run; chronological; hourly resolution
                    ├─ inputs/         # per-run: ignition + weather
                    ├─ outputs/        # arrival-time, perimeters, spread, …
                    └─ validations/    # captured reality + comparison (§9.4)
```

Notes:
- `inputs/dem/` and `inputs/fuels/` are **folders**, not single files, to allow **versioning over time** ([§7](#seven)) and derived products.
- Run folders are keyed by **date + hour, UTC** (`YYYY-MM-DDThhZ`), and are inherently chronological. **No run-per-day is assumed** — gaps are normal.
- Originals are retained adjacent to canonical artifacts ([§8](#eight)).

## <a name="six"></a> 6. The manifest (`manifest.json`)

The manifest is the dataset's brain. It MUST include:

| Field | Description |
|-------|-------------|
| `ondVersion` | The `.ond` standard version this file conforms to. |
| `crs` | The dataset coordinate reference system (see [§7](#seven)). |
| `extent` | Spatial bounding box of the landscape. |
| `temporalExtent` | Earliest/latest run timestamps present. |
| `landscape` | Inventory of DEM/fuels artifacts **with their versions/effective dates** ([§7](#seven)). |
| `fires[]` | Index of fires: id, label, and per-fire run index. |
| `runs[]` | Per run: engine, timestamp, output inventory, and **`derivedFrom`** lineage ([§9.3](#runs)). |
| `provenance[]` | Index mapping each **canonical artifact → its original(s)** ([§8](#eight)). |
| `contents` | Declaration of which OPTIONAL parts are present ([§10](#ten)). |
| `checksums` | **[TBD-v1.0]** per-artifact integrity hashes. |

Schema formalisation (JSON Schema) is **[TBD-v1.0]**.

## <a name="seven"></a> 7. Coordinate reference & units

In an interchange format these **cannot** be left to the implementation:

- The dataset declares a single `crs`; all spatial artifacts are stored in it OR carry their own CRS metadata (GeoTIFF/GeoJSON support this) — **[TBD-v1.0]: decide single-CRS vs per-artifact CRS.**
- Units for each canonical quantity (e.g. weather variables) are **fixed by the canonical schema** ([§9](#nine)), not free-form.
- **Versioning over time:** `inputs/dem/` and `inputs/fuels/` MAY contain multiple versions keyed by effective date; the manifest's `landscape` inventory records which version applies when. (MVP MAY carry a single version.)

## <a name="eight"></a> 8. Originals & provenance (losslessness)

- For every canonical artifact, the **raw original is retained verbatim**, stored adjacent to (or referenced from) its canonical form.
- The manifest `provenance[]` index maps canonical → original(s), recording source, retrieval time, and original format.
- This makes the dataset **auditable** and allows canonical forms to be **re-derived** if the canonical schema evolves.

## <a name="nine"></a> 9. Data conventions

### 9.1 Spatial
- Rasters (DEM, fuels, arrival-time grids): **GeoTIFF**, with nodata declared.
- Vectors (ignitions, perimeters): **GeoJSON** (or equivalent open vector format) — **[TBD-v1.0]: confirm vector format(s).**

### 9.2 Canonical schemas
- **Weather** is carried in a **canonical, versioned, engine-neutral schema** — *not* an engine-specific CSV. The schema version is declared in the manifest. Import coerces any source into this schema **and keeps the original** ([§8](#eight)). The concrete weather schema is **[TBD-v1.0]**.
- Ignition and perimeter canonical schemas: **[TBD-v1.0]**.

### <a name="runs"></a> 9.3 Runs, models & lineage
- A run is identified by `(<engine>, <timestamp>)`.
- A **re-run** (e.g. hindcast with actual weather) is a first-class run with a manifest **`derivedFrom`** link to its parent run. Re-runs are served/compared like any run; nothing floats free.

### <a name="validation"></a> 9.4 Validation
- A run's `validations/` MAY contain captured reality (real perimeter, observed weather) and a **comparison** between forecast, actual-weather re-run, and observed reality — supporting forecast-verification and model-skill attribution. Concrete comparison artifacts: **[TBD-v1.0]**.

## <a name="ten"></a> 10. Required vs optional (essentials)

To support deliberate, user-chosen lighter datasets (e.g. stripping non-essential outputs on export):

- The standard defines a **REQUIRED (essential)** minimum: a valid `.ond` MUST contain a conformant `manifest.json` and the landscape `inputs/` it declares.
- Everything else (fires, runs, outputs, validations, individual originals) is **OPTIONAL**, and the manifest's `contents` field declares what is present.
- A stripped dataset is **still valid/conformant** — it simply contains fewer optional parts. **Partial content is always an explicit authoring choice, never an accidental drop.**
- Exact essential set: **[TBD-v1.0]** (proposed minimum above).

## <a name="eleven"></a> 11. Conformance

- A **conformant writer** produces files honouring [§4](#four)–[§10](#ten).
- A **conformant reader** can read any conformant file without loss of declared content, and can reconstruct provenance.
- **Round-trip:** read-then-write of a full dataset by a conformant tool MUST preserve all declared content and provenance. The acceptance test is round-trip fidelity **through a foreign (non-producing) reader**.

## <a name="twelve"></a> 12. Versioning & governance

- The standard is **versioned, RFC-style**. Files declare `ondVersion`.
- **Version authority is decoupled from any implementation's release cycle.** Other tools' conformance must not break because one implementation shipped.
- Up/down version-migration tooling is intended; deterministic migration is enabled by the canonical-form discipline.
- Governance/ownership model: **[TBD-v1.0]**.

## <a name="thirteen"></a> 13. Open issues for v1.0

The **[TBD-v1.0]** items above, consolidated: manifest JSON Schema; single-vs-per-artifact CRS; concrete canonical weather/ignition/perimeter schemas; vector format(s); checksums; the precise essential set; validation comparison artifacts; governance/ownership.

---

_Companion documents: the team briefing deck (`nomad-data-center-team-briefing.html`) and the Deliverable A design proposal (`nomad-deliverableA-design-proposal.md`). Requirements basis: `nomad-ond-spec-requirements.md`._
