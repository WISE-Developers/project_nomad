# Nomad Engine Port-Leak Survey

Read-only Clean Architecture survey. Goal: classify each `getFireSTARREngine()` caller as
**MECHANICAL** (switchable to `getEngine(EngineType.FireSTARR): IFireModelingEngine` with no other
change) or **PORT-LEAK** (depends on a concrete-only method, requiring a port/ISP design decision).

No source was modified.

## 1. Port surface — `IFireModelingEngine`

`src/application/interfaces/IFireModelingEngine.ts` declares **8** methods:

| Method | Line |
|--------|------|
| `getCapabilities(): EngineCapabilities` | :117 |
| `initialize(model, options): Promise<void>` | :128 |
| `execute(modelId): Promise<void>` | :138 |
| `getStatus(modelId): Promise<ExecutionStatus>` | :146 |
| `getResults(modelId): Promise<ModelResult[]>` | :155 |
| `cancel(modelId): Promise<void>` | :163 |
| `cleanup(modelId, keepResults?): Promise<void>` | :171 |
| `validateLocation(location): Promise<{...}>` | :180 |

## 2. Concrete-only surface — `FireSTARREngine`

`src/infrastructure/firestarr/FireSTARREngine.ts` (`class FireSTARREngine implements IFireModelingEngine`, :77).
All public methods match the port **except one**:

| Public method NOT on port | Line |
|---------------------------|------|
| `getWorkingDirectory(modelId): string \| null` | :317 |

(Everything else public — `getCapabilities`, `initialize`, `execute`, `getStatus`, `getResults`,
`cancel`, `cleanup`, `validateLocation` — is on the port. The remaining members
`sampleFuelGridPixel`, `getFuelTypeName`, `buildParams`, `calculateOutputOffsets`, `buildCommand`
are `private` and not reachable by callers.)

**The single concrete-only method reached by callers is `getWorkingDirectory`.**

## 3. Call-site classification

`getModelResultsService(engine)` (`src/application/services/ModelResultsService.ts:573`) takes
`engine: IFireModelingEngine` — so passing the engine into it is a **port-only** use (MECHANICAL).

| File:line | var | cast? | methods called on var | Class |
|-----------|-----|-------|------------------------|-------|
| models.ts:218 | `engine` | no | `initialize`, `execute`, `getStatus`, `getResults` | MECHANICAL |
| models.ts:645 | `engine` | no | `initialize`, `execute`, `getStatus`, `getResults` | MECHANICAL |
| models.ts:780 | `engine` | no | passed to `getModelResultsService(engine)` (port-typed) | MECHANICAL |
| models.ts:899 | `engine` | no | passed to `getModelResultsService(engine)` (port-typed) | MECHANICAL |
| models.ts:963 | `engine` | no | passed to `getModelResultsService(engine)` (port-typed) | MECHANICAL |
| models.ts:1040 | `engine` | inline `as FireSTARREngine` (:1040) | `getWorkingDirectory` | **PORT-LEAK** |
| models.ts:1184 | `engine` | no | passed to `getModelResultsService(engine)` (port-typed) | MECHANICAL |
| models.ts:1266 | `engine` | inline `as FireSTARREngine` (:1266) | `getWorkingDirectory` | **PORT-LEAK** |
| models.ts:1371 | `engine` | no | `cleanup` | MECHANICAL |
| models.ts:1530 | `engine` | `as FireSTARREngine` | `getWorkingDirectory` | **PORT-LEAK** |
| models.ts:1588 | `engine` | `as FireSTARREngine` | `getWorkingDirectory` | **PORT-LEAK** |
| models.ts:1643 | `engine` | `as FireSTARREngine` | `getWorkingDirectory` | **PORT-LEAK** |
| jobs.ts:144 | `engine` | `as FireSTARREngine` | `getWorkingDirectory` | **PORT-LEAK** |
| mcp/tools/execution.ts:107 | `engine` | no | `initialize`, `execute`, `getResults` | MECHANICAL |

(models.ts:19 is the named import, not a call site.)

## 4. Tally

- **Total call sites: 14** (models.ts × 12, jobs.ts × 1, execution.ts × 1).
- **MECHANICAL: 8** — 218, 645, 780, 899, 963, 1184, 1371, execution.ts:107.
- **PORT-LEAK: 6** — models.ts 1040, 1266, 1530, 1588, 1643; jobs.ts:144.
- **Distinct concrete-only methods reached across all leaks: 1 — `getWorkingDirectory(modelId): string | null`.**

All 6 leaks reach the *same single* method. Every leak site already either casts via the import
form `getFireSTARREngine() as ...FireSTARREngine` (1530/1588/1643/jobs.ts:144) or applies an inline
`(engine as FireSTARREngine)` cast at the call (1040/1266).

## 5. Recommendation

The leak is narrow and uniform: **one method, `getWorkingDirectory`, across six sites.** This is a
classic port-completeness gap, not a sprawling ISP violation.

Two viable resolutions:

1. **Lift `getWorkingDirectory` onto a small typed sub-interface (preferred, ISP-respecting).**
   Define e.g. `IWorkspaceAwareEngine { getWorkingDirectory(modelId): string | null }` in the
   application layer and have `FireSTARREngine` implement both it and `IFireModelingEngine`.
   The 6 leak sites then resolve via `getEngine(...)` returning `IFireModelingEngine`, narrowed to
   `IWorkspaceAwareEngine` only where a working dir is needed. This keeps the core execution port
   minimal while giving filesystem-location consumers a typed contract instead of a concrete cast —
   honoring Interface Segregation (many specific interfaces over one fat one).

2. **Widen `IFireModelingEngine` with `getWorkingDirectory`.** Simpler (one edit, all casts vanish),
   but it pushes a filesystem/workspace concern onto every engine — engines that don't materialize a
   working directory would have to return `null`, weakening the port's cohesion and inviting LSP
   smells. Acceptable only if a working directory is genuinely universal across engine
   implementations.

**Guidance:** prefer option 1. `getWorkingDirectory` is a workspace/filesystem concern distinct from
the execute/status/results lifecycle that defines the core port. Segregating it keeps the primary
port clean and makes the dependency explicit at exactly the call sites that need disk access. Once
the sub-interface exists, all 14 sites can move to `getEngine(EngineType.FireSTARR)` — the 8
mechanical ones directly, the 6 leak ones via a single narrowing cast to the new sub-interface
(replacing the current concrete cast).
