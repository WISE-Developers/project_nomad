# Project Nomad — Architecture Remediation (Phase 2)

**Date:** 2026-06-14
**Author:** Sage (with Franco)
**Status (2026-06-17): COMPLETE for the behavior-preserving scope.** Done & green: the DIP/structure items — engine resolver + `IWorkspaceAwareEngine` (inventory 1+2), weather-types lift (3), `ModelResultsService` port injection (4), and `TimeRange`/notification-enum relocation (6+5). Backend suite **433 green**, build green, on branch `chore/arch-remediation-phase2`.

**Lifted out (NOT behavior-preserving → separate scope/approval):** inventory item 7 (`IOpenNomadAPI` LSP contract redesign — the "not implemented" throws ARE current behavior; the fix changes call-site behavior and breaks the public agency seam) and inventory item 8 (`ExportBundleBuilder` — removing the import-time `setInterval` changes side-effect timing). These are real improvements but alter functionality, so they do not belong in a behavior-preserving phase. See `nomad-opennomad-contract-proposal.md` for the item-7 design.
**Predecessors:** `nomad-architecture-compliance-review-phase1.md` (method) · `nomad-architecture-drift-inventory.md` (findings) · `nomad-test-baseline.md` (green baseline)

---

## Objective

Remediate the 8 drift items from the Phase-1 inventory as **behavior-preserving, test-guarded refactors**. Nothing the user sees changes. When done, Nomad genuinely conforms to SOLID + Clean Architecture and the Open Nomad Data Service can plug in at clean seams.

**This is Phase 2 of 3.** Phase 3 (build the data service) does not begin until Phase 2 is complete and green.

## Non-negotiable discipline (Franco's TDD rules)

For **every** item, in order:
1. **Red/characterization first** — write a test that pins *current* behavior. Show Franco the test output before any implementation change.
2. **Refactor under green** — make the structural change; the pinned test plus the full suite must stay green.
3. **Never edit a test to make it pass** — if a test goes red, the *code* is wrong, not the test.
4. **One item at a time. Check in with Franco at each item** before moving to the next.
5. **Commit only on green.** Feature/chore branch → merge into `dev` (never PR to dev). PR only `dev` → `main`.
6. **Compile before pushing** — full `npm run build` both sides, not just type-check. Test → build → show → push.

**Baseline to preserve:** BE 383/383 · FE 359/359 · 742 total, all green (see `nomad-test-baseline.md`).

## Branch

Single chore branch off `dev`: `chore/arch-remediation-phase2` (or per-item branches merged into `dev` if Franco prefers finer granularity — confirm at kickoff).

---

## Execution order (keystone-first)

Each item: **gate (test to write first) → refactor shape → done-when**. Severity/coverage carried from the inventory.

### Item 1 — Backend engine-selection seam (inventory #1 + #2) — **HIGH · blocks data service · UNCOVERED**
The keystone. `switch (engineType)` in `ModelExecutionService.ts:122,273` + concrete `getFireSTARREngine` imports at `results.ts:15,59,171,261,301` (and `jobs.ts`, `models.ts`).
- **Gate (write FIRST):**
  - Characterization spec for `isEngineAvailable` / `getEngineCommand` covering FireSTARR case, the vestigial WISE-stub branch, and the `default` "Unknown engine type" path.
  - HTTP-level characterization net over the four `results.ts` call sites (current FireSTARR behavior).
- **Refactor shape:** introduce `getEngine(engineType): IFireModelingEngine` resolver registry in the composition root; redirect routes + service to the abstraction; delete the two switches.
- **Done when:** no caller branches on `engineType`; adding a 2nd engine touches only the registry; suite green; build green.

### Item 2 — Port weather-types leak (inventory #3) — **MED · partial-blocker · UNCOVERED(port)**
`IFireModelingEngine` imports `WeatherConfig`/`WeatherDataPoint` from `infrastructure/weather/types.ts`.
- **Gate:** engine-seam impl tests already cover behavior; add a port-contract assertion.
- **Refactor shape:** lift the weather types into the port's own layer (bundle naturally with Item 1 so a new engine isn't forced onto FireSTARR's infra types).
- **Done when:** the port imports nothing from `infrastructure/`; green; build green.

### Item 3 — `ModelResultsService` port injection (inventory #4) — **MED · UNCOVERED**
Imports `infrastructure/database/index`, calls `getJobRepository()`/`getResultRepository()` directly, plus firestarr extractors.
- **Gate (write FIRST):** characterization test driving the service with fake repos — aggregates results for a known modelId, surfaces the not-found path.
- **Refactor shape:** inject `IJobRepository`/`IResultRepository` + extractor abstractions via the constructor/composition root.
- **Done when:** no concrete `infrastructure/*` imports in the service; green; build green.

### Item 4 — `IOpenNomadAPI` contract split (inventory #7) — **MED · partial-blocker · THIN**
`DefaultOpenNomadAPI` throws "not implemented" on ~12 methods; contract ambiguous on mandatory-vs-host.
- **Gate:** pin the full throwing roster (extend from the 3 currently covered).
- **Refactor shape:** split `spatial.data` vs `spatial.map`; formalize a mandatory-vs-host method roster so an adapter can't ship half-implemented and type-check. (OCP already clean — new adapters coexist — so blast radius is contained.)
- **Done when:** contract distinguishes required vs optional; LSP gap closed; green; build green. *(This hardens the exact seam the data service plugs into.)*

### Item 5 — `ExportBundleBuilder` lifecycle extraction (inventory #8) — **LOW · UNCOVERED**
Builder + module-level `bundleStore` Map + import-time `setInterval` TTL sweep.
- **Gate (write FIRST):** `ExportBundleBuilder.spec.ts` pinning `build()` manifest shape (paths, format, sizes) with deps faked; `BundleStore.spec.ts` pinning store→get→TTL-evict.
- **Refactor shape:** extract `BundleStore`/`EphemeralBundleCache`; remove the import-side-effect timer (fail-fast / no side-effects on module load).
- **Done when:** no timer runs at import; store is a separate unit; green; build green.

### Item 6 — `TimeRange` parser relocation + notification enum relocation (inventory #6 + #5) — **HIGH*/MED · lowest risk, do last**
`TimeRange.ts:43` → `shared/dateParsing`; `INotificationPreferencesRepository` → migration enum.
- **Gate:** quick `fromISO`/`validateDates` spec (bad-start/bad-end throw, reversed-range rejection); `dateParsing` already covered.
- **Refactor shape:** relocate/inline the pure parser into `domain/`; move `NotificationEventType` to a domain/port-side type.
- **Done when:** domain has zero outward edges; the port references no migration; green; build green.

---

## Definition of done (Phase 2)
- All 8 inventory items remediated; re-run the directed-graph DIP scan to confirm **zero inner→outer concrete edges remain** (re-prove, don't assert).
- Engine seam passes **OCP** (was the only SOLID failure at that seam).
- `IOpenNomadAPI` passes **LSP**.
- Suite green: ≥742 tests (new characterization tests added, none removed/weakened).
- Both builds green.
- Merged to `dev`. Inventory + this plan updated to reflect reality.

## Out of scope (Phase 2)
- Building the Open Nomad Data Service / `.ond` standard (Phase 3).
- The stale-doc reconciliations (SpatiaLite vs SQLite; WISE vs FireSTARR-only; docs predating the backend layout) — tracked separately as doc-drift, fixable anytime, not gated on code.

## Verification loop per item
`write test → show RED/characterization → refactor → full suite green → build green → show Franco → commit → next item.`
