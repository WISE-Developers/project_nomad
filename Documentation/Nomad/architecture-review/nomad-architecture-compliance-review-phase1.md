# Nomad Architecture Compliance Review — Phase 1 (Review Only)

**Date:** 2026-06-14
**Author:** Sage (with Franco)
**Status:** Approved — ready to execute
**Repo:** `projects/project_nomad`
**Evidence base:** `graphify-out/` (knowledge graph built 2026-06-14 — 3,378 nodes, 6,969 edges, 190 communities)

---

## Why this exists

Franco's vision is the **Open Nomad Data Service** (an optional sidecar) plus the **Open Nomad Data Set** (`.ond` standard). It only plugs in cleanly if Nomad genuinely honours SOLID + Clean Architecture. Franco suspects the build has **drifted** from that spec. Before any new code, we must find out.

This is a three-phase road. **This plan covers Phase 1 only.**

1. **Review** ← *this plan* — measure as-built against the spec; produce a ranked, evidence-backed drift inventory.
2. **Remediate** — fix true drift as **behavior-preserving, test-guarded refactors**. No functional change. (Separate plan, written only after Franco sees the inventory.)
3. **Build** — design/build the data service on the cleaned seams. (Future.)

## The objective (agreed)

**Prove — with evidence, not assertion — that Nomad's principles are well executed.** The two load-bearing principles:

- **Separation of Concerns** — each module/layer has one reason to change.
- **Dependency Inversion / dependency direction** — dependencies point **inward**; domain depends on nothing outward; frameworks (Express, React, Knex, FireSTARR) depend on the domain through **interfaces**.

The other SOLID principles are checked as corollaries (OCP/LSP/ISP at the engine seam and interfaces).

## Scope discipline (what counts as "drift")

The bar for flagging a violation:

> Does this deviation **(a)** violate dependency direction, **(b)** break separation of concerns, or **(c)** block the future data service from plugging in at a clean seam?

If none of those — it is **noted, not flagged.** Healthy simplicity ("three similar lines beats a premature helper") is NOT drift. The review must not manufacture work.

**Out of scope for Phase 1:** any code change, any refactor, any data-service design. Review and report only.

---

## Method

### Step 0 — Rebuild the graph as directed
The current graph is undirected (good for cohesion/bridges, blind to direction). Rebuild with `--directed` so source→target is preserved. Dependency-direction proof requires it.
- `graphify projects/project_nomad --directed` (or rebuild from cached extraction with `directed=True`).

### Step 1 — Establish the spec (the yardstick)
Extract the *intended* architecture so we measure against Franco's spec, not a generic ideal. Sources:
- `Documentation/Nomad/ARCHITECTURE.md`
- `original_draft_spec.md`, `NOMAD_REQUIREMENTS.md`, `FIRESTARR_REQUIREMENTS.md`
- `frontend/src/openNomad/README.md` (the existing abstraction seam)
- Franco's standards: `Documentation/persist/standards/`
**Output:** a one-page "intended layering + dependency rules" reference.

### Step 2 — Map the as-built layers
Assign every module to a layer (Entities / Use-Cases / Interface-Adapters / Frameworks). Use graph communities + source paths.
**Output:** layer assignment table; note anything that can't be cleanly placed (a smell in itself).

### Step 3 — Prove Dependency Inversion (the core check)
Using the directed graph: enumerate **every edge from an inner-layer node to an outer-layer node** (domain → framework/infrastructure). Each such edge is a candidate violation.
- Confirm the engine boundary inverts properly: callers depend on `IFireModelingEngine`, not `FireSTARREngine` concretely.
- Confirm domain entities (`FireModel`, `Result`, `EngineType`, `SpatialGeometry`) import nothing from Express/React/Knex/FireSTARR.
**Output:** list of inward-violating edges with file:line.

### Step 4 — Prove Separation of Concerns
- **Cohesion:** review low-cohesion communities flagged by the graph — `Dashboard Container UI` (~0.06), `Backend Validation` (~0.06), `Export Bundle Builder` (~0.08). Are these god-components mixing concerns (SRP)?
- **Bridges:** examine cross-community bridge nodes — esp. `ValidationError` reaching domain + engine + Knex repo + ACN auth. Is it leaking concerns across boundaries?
**Output:** SRP/SoC findings per flagged module.

### Step 5 — OCP / LSP / ISP corollaries
- **OCP/LSP** at `IFireModelingEngine`: can a new engine be added without touching callers? (This is exactly what the data service will mimic.)
- **ISP**: are interfaces focused or fat? Check `IFireModelingEngine`, the openNomad API surface, repository interfaces.
**Output:** per-seam verdict.

### Step 6 — Overlay test coverage → danger zones
Cross-reference findings against the VITEST suites (frontend + backend). **Drift + no test net = danger zone** (riskiest to remediate in Phase 2). Mark each finding: covered / thin / uncovered.
**Output:** coverage flag on every finding.

### Step 7 — Synthesize the drift inventory
Single ranked report. Each finding: principle violated · location · evidence (graph edge / file:line) · severity · blocks-data-service? · test-coverage status · proposed remediation *shape* (not the work itself).

---

## Execution notes
- **Delegate to background agents**, pre-permissioned, to conserve main-thread context. Each step (esp. 3, 4, 6) is an agent task with a structured-output schema; orchestrator synthesizes.
- **Directed-graph queries** (`graphify query` / `path` / `explain`) answer specific suspicions instead of hand-grep.
- Track every step as a todo so Franco can watch progress.

## Deliverable
`Documentation/plans/nomad-architecture-drift-inventory.md` — the ranked, evidence-backed inventory. Franco reviews it before any Phase 2 remediation plan is written.

## Definition of done (Phase 1)
- Directed graph built.
- Intended-spec reference written.
- DIP, SoC, OCP/LSP/ISP each proven or violations enumerated with evidence.
- Every finding carries a coverage flag.
- Drift inventory delivered and reviewed by Franco. **No code touched.**
