# Design: MCP Server for AI-Driven Fire Modeling

**Created:** 2026-02-27
**Author:** Sage
**Status:** Implemented (Phase 1)
**Issue:** #167
**Reviewed by:** Synthesis (2026-02-27)

## Overview

Add an optional MCP (Model Context Protocol) server to Project Nomad, enabling AI agents to create, configure, execute, and interpret fire modeling simulations through conversational interfaces. The MCP server runs inside the existing Express backend — same process, same port, same service layer — and is available in all deployment modes (SAN and ACN).

## Why This Matters

Fire modeling currently requires specialized GUI knowledge. An FBAN says "I need to know if this fire reaches the highway by morning" — today that's 15 minutes of manual setup. With MCP, an AI agent translates operational language directly into simulation parameters, executes the model, and interprets results in terms the analyst actually needs.

Three user scenarios drive the design:

1. **Fire analyst + AI**: Conversational modeling — natural language to simulation to interpreted results
2. **Automated batch**: Sensitivity analysis, scenario comparison, overnight batch runs
3. **Training**: AI-guided learning for new modelers, explaining why fire behaves the way it does

## Architecture

### Integration Point

The MCP server mounts as routes on the existing Express app:

```
Express App (existing)
├── /api/v1/*          ← REST API (existing)
├── /mcp               ← MCP Streamable HTTP endpoint (new)
│   ├── POST /mcp      ← Client→Server messages + session init
│   ├── GET /mcp       ← Server→Client SSE stream (progress)
│   └── DELETE /mcp    ← Session termination
└── static files       ← Frontend (existing)
```

MCP tool handlers call the **same service layer** as the REST API. Zero duplication of business logic:

```
REST route handler ──┐
                     ├──→ Service Layer ──→ FireSTARREngine
MCP tool handler ────┘
```

### Transport

**Streamable HTTP** — the current MCP standard (spec 2025-03-26). SSE transport is deprecated.

### Session Lifecycle — Design Decision

**v1: Stateless.** Each MCP request is independent — no session ID, no server-side session state. This is simpler to operate, debug, and scale. The stateless pattern works because long-running simulations use the enqueue/poll pattern (see Long-Running Simulation Pattern below) rather than holding a connection open.

**Future: Stateful sessions** may be introduced when progress streaming justifies the complexity — e.g., real-time timestep notifications during a multi-hour simulation. This is explicitly deferred, not forgotten. The Streamable HTTP transport supports both modes; switching is a configuration change, not a rewrite.

### Deployment Mode Behavior

| Mode | MCP Available | Auth |
|------|--------------|------|
| SAN  | Yes (opt-in via `NOMAD_ENABLE_MCP=true`) | Same-origin, simple auth |
| ACN  | Yes (opt-in via `NOMAD_ENABLE_MCP=true`) | ACN middleware applies to `/mcp` routes |

The MCP endpoint respects the same auth middleware stack as the REST API. In ACN mode, AI agents connecting via MCP must provide agency credentials.

### Dependencies

```
@modelcontextprotocol/sdk    # Core SDK (server, transports, types)
zod                          # Already in project (schema validation)
```

Single new dependency. `zod` is already used by Nomad.

## Tool Catalog

### v1 — Implemented (9 Tools)

These tools enable: create model → set parameters → execute → get results.

| Tool | Description | Input | Output |
|------|-------------|-------|--------|
| `list-models` | List existing fire models | `{ status?, limit? }` | Model summaries with config completeness |
| `create-model` | Create a new fire model | `{ name, description? }` | `{ modelId }` (FireSTARR only) |
| `set-ignition` | Set ignition geometry | `{ modelId, type: 'point'\|'polygon', coordinates: [lon,lat]\|[[lon,lat],...] }` | Confirmation |
| `set-weather` | Configure weather data source | `{ modelId, source: 'firestarr_csv'\|'raw_weather'\|'spotwx', firestarrCsvContent?, rawWeatherContent?, startingCodes?, latitude? }` | Confirmation |
| `set-simulation-time` | Set time range | `{ modelId, startTime, endTime }` (ISO 8601) | Confirmation |
| `execute-model` | Submit model for execution | `{ modelId }` | `{ jobId, status }` |
| `get-job-status` | Poll execution status | `{ jobId }` | `{ status, progress?, timestamps }` |
| `get-results-summary` | Get templated results summary | `{ modelId }` | Deterministic textual summary |
| `get-results-data` | Get structured result data | `{ modelId }` | Result file inventory with metadata |

**Removed:** `set-fuel-type` — FireSTARR reads fuel from raster grid at ignition location. Not a user parameter.

**Config storage:** Model configuration is stored in `config_json` column on `fire_models` table (database-backed, survives restarts).

### v2 — Batch and Comparison

| Tool | Description |
|------|-------------|
| `clone-model` | Clone an existing model for parameter variation |
| `compare-results` | Compare outputs from multiple model runs |
| `batch-execute` | Execute multiple models in sequence |
| `export-results` | Export results in GeoJSON/KML/shapefile |

### v3 — Spatial Awareness

| Tool | Description |
|------|-------------|
| `query-fuel-at-point` | Get fuel type at coordinates from fuel grid |
| `query-elevation` | Get elevation/slope/aspect at coordinates |
| `query-weather-stations` | Find nearby weather stations |
| `import-weather-stream` | Import weather data from station |

## Resource Catalog

MCP resources provide domain knowledge — they don't perform actions, they give the AI context to make intelligent decisions.

### v1 Resources

| Resource | URI | Description |
|----------|-----|-------------|
| Fuel Type Catalog | `nomad://knowledge/fuel-types` | All FBP fuel types with descriptions, behavior characteristics, typical fire intensities |
| Weather Index Guide | `nomad://knowledge/fwi-system` | FWI components (FFMC, DMC, DC, ISI, BUI, FWI) — what they mean, operational thresholds |
| Model Parameters Guide | `nomad://knowledge/model-parameters` | What each parameter does, valid ranges, defaults, common mistakes |
| Active Models | `nomad://models` | Dynamic: list of current models with status |
| Model Detail | `nomad://models/{modelId}` | Dynamic: full configuration of a specific model |
| Job Status | `nomad://jobs/{jobId}` | Dynamic: execution status and progress |
| Results | `nomad://models/{modelId}/results` | Dynamic: completed simulation outputs |

### Domain Knowledge Content

The static resources (fuel types, FWI system, model parameters) are the differentiator. They transform the AI from a button-presser into a fire behavior analyst. Content sourced from:

- Canadian Forest Fire Behavior Prediction (FBP) System documentation
- WISE technical documentation
- Operational fire modeling best practices

Example — a fuel type resource entry:
```json
{
  "code": "C-2",
  "name": "Boreal Spruce",
  "description": "Dense black spruce stands with feathermoss understory. High crown fire potential.",
  "characteristics": {
    "crownFirePotential": "high",
    "typicalROS": "5-15 m/min under moderate conditions",
    "spotting": "moderate",
    "sensitivity": "Very responsive to wind speed. ISI is the dominant spread driver."
  },
  "operationalNotes": "Crown fires common above ISI 10. Surface fires transition rapidly. Watch for spotting across fuel breaks."
}
```

## Long-Running Simulation Pattern

Fire simulations can run minutes to hours. The MCP server handles this with an async enqueue pattern:

```
AI calls execute-model
  └→ Tool enqueues job via EngineManager
  └→ Returns immediately: { jobId, status: 'queued' }

AI calls get-job-status (polling)
  └→ Returns: { status: 'running', progress: 45, message: 'Computing timestep 12/27' }

AI calls get-job-status (later)
  └→ Returns: { status: 'complete', resultId: '...' }

AI calls get-results-summary
  └→ Returns: "Fire spread 2.3 km NE in 6 hours. Area burned: 450 ha. Head fire ROS: 12 m/min."
```

Stateful session streaming (progress notifications over SSE) is deferred to a future version. See Session Lifecycle decision above.

## Error Taxonomy

MCP tools must return structured errors the AI can reason about — not HTTP status codes, not stack traces.

### Error Categories

Every tool error returns `isError: true` with a structured `content` block:

```json
{
  "isError": true,
  "content": [{
    "type": "text",
    "text": "human-readable explanation"
  }],
  "structuredContent": {
    "code": "INVALID_FUEL_TYPE",
    "category": "validation",
    "field": "fuelType",
    "value": "X-99",
    "message": "Unknown fuel type 'X-99'. Valid FBP types: C-1, C-2, C-3, ...",
    "recoverable": true,
    "suggestion": "Use 'list-fuel-types' resource to see valid options"
  }
}
```

### Error Codes by Category

| Category | Code | When | Recoverable |
|----------|------|------|-------------|
| **validation** | `INVALID_PARAMETER` | Parameter out of range (e.g., wind speed -5) | Yes — fix and retry |
| **validation** | `INVALID_FUEL_TYPE` | Unknown FBP fuel type code | Yes — check catalog |
| **validation** | `MISSING_REQUIRED` | Model missing required fields for execution | Yes — set the field |
| **validation** | `INVALID_COORDINATES` | Lat/lng outside valid range | Yes — fix coordinates |
| **state** | `MODEL_NOT_FOUND` | Model ID doesn't exist | Yes — list models |
| **state** | `JOB_NOT_FOUND` | Job ID doesn't exist | Yes — check model |
| **state** | `MODEL_NOT_READY` | Model missing required config for execution | Yes — check what's missing |
| **state** | `MODEL_ALREADY_RUNNING` | Execution already in progress | Yes — wait or cancel |
| **engine** | `ENGINE_REJECTED` | Engine refused the parameters (physically impossible scenario) | Maybe — depends on why |
| **engine** | `ENGINE_FAILED` | Engine crashed or timed out during execution | No — investigate |
| **engine** | `ENGINE_UNAVAILABLE` | Requested engine not installed/configured | No — ops issue |
| **auth** | `UNAUTHORIZED` | Missing or invalid credentials | Yes — fix credentials |
| **auth** | `FORBIDDEN` | Valid credentials but insufficient role | No — need role change |

The `recoverable` flag and `suggestion` field are critical — they give the AI agent a next step instead of a dead end.

## Result Interpretation — Design Decision

**`get-results-summary` returns deterministic, templated output — not LLM-generated text.**

This is a deliberate choice for operational fire use:

1. **Auditable**: An FBAN who acts on model results needs to know the numbers came from the simulation, not from an LLM's interpretation. Templated summaries are reproducible — same inputs, same output, every time.

2. **Deterministic**: "Head fire ROS: 12.3 m/min, area burned: 450 ha" is a fact from the simulation. An LLM might round differently, emphasize differently, or hallucinate context. Template eliminates that risk.

3. **Liability**: Fire management decisions affect lives and property. The chain of evidence must be: engine computed → server formatted → AI presented. No generative step in between.

The template is built server-side from simulation outputs:

```
Fire Behavior Summary — Model "{name}"
Engine: {engine} | Duration: {hours}h from {startTime}

Spread:
  Head fire direction: {headFireDirection}°
  Head fire ROS: {headFireROS} m/min
  Max spotting distance: {maxSpotting} m

Area:
  Total burned: {areaBurned} ha
  Perimeter: {perimeter} km

Intensity:
  Peak HFI: {peakHFI} kW/m
  Crown fraction burned: {cfb}%
```

The AI receives this structured text and can then add its own interpretation, context, and recommendations in conversation — but the underlying data is never generated, only reported.

`get-results-data` returns raw structured data (GeoJSON perimeters, CSV time series) for agents that want to do their own analysis.

## Tool Versioning

MCP tools are called by name. When tools evolve, backward compatibility matters.

### Strategy: Additive-Only with Optional Parameters

- **New parameters are always optional** with sensible defaults. An agent built against v1's `set-weather` continues to work when v2 adds `precipitation` — it simply gets the default value.
- **Parameter removal is a breaking change** — never remove a parameter. Deprecate it: accept it, ignore it, log a warning.
- **New tools can be added freely** — agents that don't know about them simply don't call them.
- **Tool renaming is a breaking change** — never rename. Add the new name, keep the old one as an alias that delegates.

### Schema Evolution Example

```typescript
// v1
inputSchema: z.object({
  modelId: z.string(),
  temperature: z.number(),
  windSpeed: z.number(),
  windDirection: z.number(),
})

// v2 — additive only, v1 agents unaffected
inputSchema: z.object({
  modelId: z.string(),
  temperature: z.number(),
  windSpeed: z.number(),
  windDirection: z.number(),
  precipitation: z.number().optional().default(0),        // new
  relativeHumidity: z.number().optional().default(50),     // new
})
```

### Server Version Resource

Expose `nomad://server/capabilities` as a resource so agents can discover what's available:

```json
{
  "version": "1.0.0",
  "tools": ["list-models", "create-model", "set-ignition", "..."],
  "engines": ["firestarr"],
  "features": ["batch", "spatial-query"]
}
```

## File Structure

```
backend/src/
├── mcp/
│   ├── index.ts                    # MCP server creation + Express mounting
│   ├── errors.ts                   # Structured error taxonomy
│   ├── tools/
│   │   ├── models.ts               # create, list, configure model tools (5 tools)
│   │   ├── execution.ts            # execute, status, results tools (4 tools)
│   │   └── index.ts                # tool registration barrel
│   ├── resources/
│   │   ├── dynamic.ts              # models, model detail, jobs, results resources
│   │   ├── knowledge/
│   │   │   ├── fuel-types.ts       # FBP fuel type catalog (20 types)
│   │   │   ├── fwi-system.ts       # Fire weather index guide (6 components)
│   │   │   ├── model-params.ts     # Parameter reference
│   │   │   └── index.ts            # knowledge resource barrel
│   │   └── index.ts                # resource registration barrel
│   └── __tests__/
│       ├── integration.test.ts     # End-to-end MCP workflow test
│       ├── migration.test.ts       # config_json migration tests
│       ├── resources.test.ts       # Knowledge + dynamic resource tests
│       └── tools/
│           ├── models.test.ts      # Model tool tests
│           └── execution.test.ts   # Execution tool tests
```

## Configuration

```env
# Enable MCP server (default: false)
NOMAD_ENABLE_MCP=true

# MCP endpoint path (default: /mcp)
NOMAD_MCP_PATH=/mcp
```

Backend startup in `index.ts`:

```typescript
if (process.env.NOMAD_ENABLE_MCP === 'true') {
  const { mountMcpServer } = await import('./mcp/index.js');
  mountMcpServer(app, services);
  logger.startup('MCP server enabled at /mcp');
}
```

Dynamic import ensures zero overhead when MCP is disabled. The `services` object passes the shared service layer (model service, engine manager, result service) so MCP tools call the same business logic as REST routes.

## Security Considerations

- MCP endpoint sits behind the same auth middleware as REST API
- In ACN mode: agency credentials required on all MCP requests
- In SAN mode: simple auth applies (same as REST)
- `NOMAD_ENABLE_MCP` is opt-in — disabled by default
- Tool inputs validated via Zod schemas (same as REST validation)
- No filesystem access exposed — tools only interact through the service layer
- Rate limiting: same as REST API (existing Express middleware)

## What This Does NOT Include

- **MCP client** — consumers bring their own (Claude Code, Claude Desktop, custom agents)
- **Prompt templates** — the AI's system prompt is the consumer's responsibility
- **Map rendering** — AI works with structured data, not visual output
- **Direct engine access** — all operations go through the service/engine manager layer

## Implementation Phases

### Phase 1: First Fire — COMPLETE
- MCP server module with Streamable HTTP transport (stateful sessions)
- Mount on Express app behind `NOMAD_ENABLE_MCP` feature flag
- 9 tools: `list-models`, `create-model`, `set-ignition`, `set-weather`, `set-simulation-time`, `execute-model`, `get-job-status`, `get-results-summary`, `get-results-data`
- Error taxonomy with structured errors, recovery suggestions, and weather-specific error codes
- 7 resources: 3 knowledge (fuel-types, fwi-system, model-parameters) + 4 dynamic (models, model detail, jobs, results)
- Database-backed config storage (`config_json` column on `fire_models`)
- 63 tests passing, full TypeScript compilation clean
- **Milestone gate**: Claude Code creates a model, sets polygon ignition with FireSTARR CSV weather, executes, and retrieves results with deterministic summary.

### Phase 4: Batch and Comparison
- v2 tools: clone, compare, batch execute, export
- Scenario management for sensitivity analysis

### Phase 5: Spatial Intelligence
- v3 tools: fuel/elevation/weather queries at coordinates
- AI builds landscape understanding from structured data

## Success Criteria

1. An AI agent can create, configure, execute, and retrieve results for a fire simulation using only MCP tools — no GUI interaction
2. MCP tools share the same service layer as REST API — no duplicated business logic
3. Feature flag (`NOMAD_ENABLE_MCP`) enables/disables cleanly with zero overhead when disabled
4. Auth works correctly in both SAN and ACN modes
5. Domain knowledge resources give the AI genuine fire behavior understanding
