# Nomad MCP Server — AI-Driven Fire Modeling

Project Nomad exposes a [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server that lets AI agents create, configure, execute, and interpret FireSTARR fire simulations through conversational interfaces.

The MCP server runs inside the existing Express backend — same process, same port, same database. It is an alternative interface to the same fire modeling pipeline that the REST API uses.

```
REST route handler ──┐
                     ├──→ Service Layer ──→ FireSTARREngine
MCP tool handler ────┘
```

## Enabling

Set the environment variable and start the backend:

```env
NOMAD_ENABLE_MCP=true
```

The MCP endpoint mounts at `/mcp` (configurable via `NOMAD_MCP_PATH`). When disabled (the default), zero MCP code is loaded — the import is dynamic.

Both deployment modes are supported:

| Mode | Auth |
|------|------|
| **SAN** (Stand Alone Nomad) | Same-origin, simple auth |
| **ACN** (Agency Centric Nomad) | Agency middleware applies to `/mcp` routes |

## Transport

**Streamable HTTP** (MCP spec 2025-03-26). The endpoint handles:

- `POST /mcp` — client messages + session initialization
- `GET /mcp` — server-sent events (progress notifications)
- `DELETE /mcp` — session termination

Sessions are stateful. Each client gets an isolated MCP server instance with its own session ID.

## Tools (9)

### Model Setup

| Tool | What It Does |
|------|-------------|
| `create-model` | Create a new fire model. Engine is always FireSTARR. Returns a `modelId`. |
| `list-models` | List existing models with status and which config sections are set. |

### Configuration

| Tool | What It Does |
|------|-------------|
| `set-ignition` | Set ignition as a point `[lon, lat]` or polygon `[[lon,lat], ...]`. Coordinates use GeoJSON order (longitude first). |
| `set-weather` | Set weather data. Three sources: `firestarr_csv` (pre-computed FWI), `raw_weather` (needs CFFDRS calc + starting codes), or `spotwx` (auto-fetch). |
| `set-simulation-time` | Set `startTime` and `endTime` as ISO 8601 strings. |

There is no `set-fuel-type` tool. FireSTARR reads fuel from the FBP raster grid at the ignition location. The `nomad://knowledge/fuel-types` resource exists so the AI can interpret what fuel the fire is burning in — not set it.

All configuration is stored in the `config_json` column on `fire_models` (database-backed, survives restarts).

### Execution

| Tool | What It Does |
|------|-------------|
| `execute-model` | Validates config completeness, builds `ExecutionOptions`, calls `FireSTARREngine.initialize()` + `execute()`, returns a `jobId`. |
| `get-job-status` | Poll a job by ID. Returns status, progress percentage, timestamps, and error details if failed. |

### Results

| Tool | What It Does |
|------|-------------|
| `get-results-summary` | Deterministic, templated summary — result count, output types, area burned, simulation dates. Not LLM-generated. |
| `get-results-data` | Structured JSON inventory of result files with paths, output types, formats, and metadata. |

Result summaries are deliberately deterministic. Fire management decisions affect lives and property. The chain of evidence is: engine computed, server formatted, AI presented. No generative step in between.

## Resources (7)

### Knowledge Resources (Static)

These transform the AI from a button-presser into an informed fire behavior analyst.

| Resource | URI | Content |
|----------|-----|---------|
| Fuel Type Catalog | `nomad://knowledge/fuel-types` | All 20 Canadian FBP fuel types with codes, names, groups, and descriptions |
| FWI System Guide | `nomad://knowledge/fwi-system` | 6 FWI components (FFMC, DMC, DC, ISI, BUI, FWI), calculation order, 5 danger rating classes with thresholds |
| Model Parameters | `nomad://knowledge/model-parameters` | Valid ranges, defaults, and descriptions for ignition, weather, time, and simulation options |

### Dynamic Resources (Live Data)

| Resource | URI | Content |
|----------|-----|---------|
| Active Models | `nomad://models` | List of all models with status |
| Model Detail | `nomad://models/{modelId}` | Full model configuration |
| Job Status | `nomad://jobs/{jobId}` | Live execution status and progress |
| Model Results | `nomad://models/{modelId}/results` | Result file inventory for completed models |

## Error Handling

Every error returns structured JSON with `isError: true` that AI agents can reason about:

```json
{
  "code": "MODEL_NOT_READY",
  "category": "state",
  "message": "Model 'abc' is missing required configuration: weather, simulation-time.",
  "recoverable": true,
  "suggestion": "Set the missing parameters using: set-weather, set-simulation-time."
}
```

Error categories: `validation`, `state`, `engine`, `auth`.

Key error codes:

| Code | When |
|------|------|
| `INVALID_PARAMETER` | Parameter out of range or wrong type |
| `INVALID_COORDINATES` | Coordinates outside valid range |
| `MODEL_NOT_FOUND` | Model ID doesn't exist |
| `MODEL_NOT_READY` | Missing required config sections |
| `MODEL_ALREADY_RUNNING` | Execution already in progress |
| `WEATHER_CSV_INVALID` | Malformed weather CSV content |
| `WEATHER_MISSING_FWI` | `raw_weather` source without starting codes |
| `ENGINE_FAILED` | Engine initialization or execution failed |
| `ENGINE_UNAVAILABLE` | FireSTARR not available on this server |

## Walkthrough: Modeling a Real Fire

This example models the 2023 Hay River / Katlodeeche fire (NWT fire SS005-23) — a 3-day pseudo-deterministic run using real ignition perimeter and weather data.

**Available test data:** `test_fires/nwt/2023_hay_river_katlodeeche_jun19/`
- `ignition.geojson` — 874-vertex polygon perimeter from the FGMJ
- `weather.csv` — 240 hourly rows, FireSTARR-ready (includes FFMC, DMC, DC, ISI, BUI, FWI columns)
- `metadata.json` — start time, coordinates, FWI starting codes

### Step 1 — Read domain knowledge (optional)

```
Resource: nomad://knowledge/fuel-types
Resource: nomad://knowledge/model-parameters
```

The AI reads these to understand valid parameters, fuel behavior at the ignition location, and what each weather source requires.

### Step 2 — Create the model

```
Tool: create-model
  { "name": "Hay River Katlodeeche - Jun 19, 2023 - 3 day" }

Response:
  { "modelId": "abc-123", "status": "draft" }
```

### Step 3 — Set polygon ignition

```
Tool: set-ignition
  {
    "modelId": "abc-123",
    "type": "polygon",
    "coordinates": [[-115.77007, 60.83278], [-115.77007, 60.83278], ... (874 vertices)]
  }
```

Coordinates come directly from the GeoJSON — already in `[lon, lat]` order.

### Step 4 — Set weather (FireSTARR CSV)

```
Tool: set-weather
  {
    "modelId": "abc-123",
    "source": "firestarr_csv",
    "firestarrCsvContent": "Scenario,Date,PREC,TEMP,RH,WS,WD,FFMC,DMC,DC,ISI,BUI,FWI\n0,2023-06-19 06:00:00,0.0,8.2,73.0,5.0,20.0,83.5,53.7,568.9,2.21,86.84,9.46\n..."
  }
```

The CSV already has FWI columns — it's FireSTARR-ready. The entire file content is passed as a string. For `raw_weather` source, you'd also provide `startingCodes` (ffmc, dmc, dc) and `latitude`.

### Step 5 — Set simulation time (3 days)

```
Tool: set-simulation-time
  {
    "modelId": "abc-123",
    "startTime": "2023-06-19T19:00:00Z",
    "endTime": "2023-06-22T19:00:00Z"
  }
```

Start time is 13:00 MDT (19:00 UTC). End time is 72 hours later.

### Step 6 — Execute

```
Tool: execute-model
  { "modelId": "abc-123" }

Response:
  { "jobId": "job-456", "status": "queued" }
```

Under the hood: reads `config_json`, builds `SpatialGeometry` (polygon), `TimeRange`, `WeatherConfig`, constructs `ExecutionOptions`, calls `FireSTARREngine.initialize()` then `execute()` in background.

### Step 7 — Poll for completion

```
Tool: get-job-status  { "jobId": "job-456" }
  → { "status": "running", "progress": 35 }

Tool: get-job-status  { "jobId": "job-456" }
  → { "status": "completed", "resultIds": ["res-789"] }
```

### Step 8 — Get results

```
Tool: get-results-summary  { "modelId": "abc-123" }
  → Deterministic summary: result count, output types, area burned, dates

Tool: get-results-data  { "modelId": "abc-123" }
  → Structured JSON: file inventory with paths, types, metadata
```

The AI receives deterministic data and can then add its own interpretation, context, and operational recommendations in conversation — but the underlying numbers are never generated, only reported.

## Weather Source Reference

| Source | When to Use | Required Fields |
|--------|-------------|-----------------|
| `firestarr_csv` | CSV already has FWI columns (FFMC, DMC, DC, ISI, BUI, FWI) | `firestarrCsvContent` |
| `raw_weather` | CSV has only observed weather (temp, RH, wind, precip) — needs CFFDRS calculation | `rawWeatherContent`, `startingCodes` (ffmc, dmc, dc), `latitude` |
| `spotwx` | Auto-fetch from SpotWX API using ignition coordinates | (none — uses ignition location) |

## File Structure

```
backend/src/mcp/
├── index.ts                    # MCP server creation + Express mounting
├── errors.ts                   # Structured error taxonomy
├── tools/
│   ├── models.ts               # create, list, set-ignition, set-weather, set-simulation-time
│   ├── execution.ts            # execute-model, get-job-status, get-results-summary, get-results-data
│   └── index.ts                # tool registration barrel
├── resources/
│   ├── dynamic.ts              # models, model detail, jobs, results
│   ├── knowledge/
│   │   ├── fuel-types.ts       # 20 FBP fuel types
│   │   ├── fwi-system.ts       # 6 FWI components + danger ratings
│   │   ├── model-params.ts     # Parameter reference
│   │   └── index.ts            # knowledge barrel
│   └── index.ts                # resource registration barrel
└── __tests__/
    ├── integration.test.ts     # End-to-end workflow
    ├── migration.test.ts       # config_json migration
    ├── resources.test.ts       # Knowledge + dynamic resources
    └── tools/
        ├── models.test.ts      # Model configuration tools
        └── execution.test.ts   # Execution + results tools
```

## Connecting an MCP Client

Any MCP-compatible client can connect. Examples:

**Claude Code** (`.mcp.json` in project root):
```json
{
  "mcpServers": {
    "nomad": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

**Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "nomad": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

The client handles session management, tool discovery, and resource reading automatically.

## Tests

```bash
cd backend
npx vitest run src/mcp/     # Run all MCP tests (63 tests, 5 files)
```

Coverage:
- 17 model tool tests (create, list, set-ignition, set-weather, set-simulation-time, validation)
- 12 execution tool tests (execute, job status, results summary, results data)
- 23 resource tests (3 knowledge + 4 dynamic)
- 8 migration tests (config_json round-trip)
- 3 integration tests (server creation, tool count, workflow)
