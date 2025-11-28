# Phase 7: FireSTARR Engine Integration - Implementation Report

**Date**: 2025-11-28
**Status**: Complete
**Branch**: `feature/phase-7-firestarr-integration`

## Summary

Phase 7 implemented the complete FireSTARR engine integration layer, providing Docker-based execution, input file generation (weather CSV, perimeter TIF), and output parsing. The implementation follows Clean Architecture principles with interfaces for testability and future engine support.

## Completed Micro-Sprints

### P7-004: Docker Executor
**Files Created:**
- `backend/src/application/interfaces/IContainerExecutor.ts`
- `backend/src/infrastructure/docker/DockerExecutor.ts`
- `backend/src/infrastructure/docker/index.ts`

**Key Features:**
- `IContainerExecutor` interface for container-based execution
- `DockerExecutor` implementation using `docker compose run --rm`
- Streaming output via callback for real-time progress
- Configurable timeout with SIGTERM → SIGKILL escalation (10s grace period)
- Service availability checking (`isAvailable()`, `isServiceAvailable()`)
- Volume mount and environment variable support
- Singleton pattern with `getDockerExecutor()`

### P7-002: Input File Generator
**Files Created:**
- `backend/src/application/interfaces/IInputGenerator.ts`
- `backend/src/infrastructure/firestarr/types.ts`
- `backend/src/infrastructure/firestarr/WeatherCSVWriter.ts`
- `backend/src/infrastructure/firestarr/PerimeterRasterizer.ts`
- `backend/src/infrastructure/firestarr/FireSTARRInputGenerator.ts`

**Key Features:**
- Generic `IInputGenerator<TParams>` interface for any engine
- `FireSTARRParams` type with all execution parameters
- Weather CSV writer with exact FireSTARR column order:
  - `Scenario,Date,PREC,TEMP,RH,WS,WD,FFMC,DMC,DC,ISI,BUI,FWI`
- GDAL-based perimeter rasterizer (optional dependency)
- Graceful degradation when GDAL unavailable
- Working directory creation at `{dataDir}/sims/{modelId}`
- Container path mapping (`/appl/data/sims/{modelId}`)
- Cleanup support with optional result preservation

### P7-003: Output Parser
**Files Created:**
- `backend/src/application/interfaces/IOutputParser.ts`
- `backend/src/infrastructure/firestarr/FireSTARROutputParser.ts`

**Key Features:**
- Generic `IOutputParser<TOutput>` interface
- Parses `probability_NNN_YYYY-MM-DD.tif` files
- Parses interim probability files
- Log file parsing for success/errors/warnings:
  - Success pattern: `Total simulation time was X.X seconds`
  - Progress pattern: `Running scenario X of Y`
- Extracts simulation count and convergence level
- Result type patterns for metadata

### P7-001: FireSTARR Engine Adapter
**Files Created:**
- `backend/src/infrastructure/firestarr/FireSTARREngine.ts`
- `backend/src/infrastructure/firestarr/index.ts`
- `backend/src/types/gdal-async.d.ts`

**Files Modified:**
- `backend/src/application/interfaces/index.ts` - Added new interface exports
- `backend/src/infrastructure/services/index.ts` - Added Docker and FireSTARR exports
- `backend/src/infrastructure/services/ModelExecutionService.ts` - Added Docker availability check, FireSTARR progress parsing

**Key Features:**
- Implements `IFireModelingEngine` interface
- Coordinates Docker executor, input generator, output parser
- Execution state tracking per model
- Progress reporting from FireSTARR output (`Running scenario X of Y`)
- Capabilities reporting (point/polygon ignition, probabilistic mode)
- Location validation (Canadian coverage: 41°N-84°N, 141°W-52°W)
- UTM zone calculation from longitude
- CLI command building with all FireSTARR arguments

## Directory Structure After Phase 7

```
backend/src/
├── application/interfaces/
│   ├── IContainerExecutor.ts     # Container execution interface
│   ├── IInputGenerator.ts        # Input file generation interface
│   ├── IOutputParser.ts          # Output parsing interface
│   └── index.ts                  # Updated exports
├── infrastructure/
│   ├── docker/
│   │   ├── DockerExecutor.ts     # Docker compose executor
│   │   └── index.ts
│   ├── firestarr/
│   │   ├── types.ts              # FireSTARR types and patterns
│   │   ├── WeatherCSVWriter.ts   # Weather CSV generation
│   │   ├── PerimeterRasterizer.ts # GDAL polygon→TIF
│   │   ├── FireSTARRInputGenerator.ts
│   │   ├── FireSTARROutputParser.ts
│   │   ├── FireSTARREngine.ts    # Main engine implementation
│   │   └── index.ts
│   └── services/
│       ├── ModelExecutionService.ts # Updated with Docker checks
│       └── index.ts               # Updated exports
└── types/
    └── gdal-async.d.ts           # GDAL type declarations
```

## FireSTARR CLI Format

```bash
firestarr <output_dir> <yyyy-mm-dd> <lat> <lon> <HH:MM> [options]

Options:
  --wx <file>           Weather CSV file path
  --ffmc <value>        Previous day's FFMC (default: 85)
  --dmc <value>         Previous day's DMC (default: 30)
  --dc <value>          Previous day's DC (default: 200)
  --apcp_prev <value>   Previous day's precipitation
  --perim <file>        Perimeter TIF file path
  --output_date_offsets JSON array of day offsets
  -v                    Verbose output
```

## Weather CSV Format

```csv
Scenario,Date,PREC,TEMP,RH,WS,WD,FFMC,DMC,DC,ISI,BUI,FWI
1,2024-05-15,0.0,18.5,45,12.3,225,87.2,32.1,198.5,8.4,42.3,15.6
```

Column order is critical - must match FireSTARR expectations exactly.

## Output File Patterns

| Pattern | Description |
|---------|-------------|
| `probability_NNN_YYYY-MM-DD.tif` | Final probability raster |
| `probs_NNN.tif` | Interim probability |
| `firestarr.log` | Execution log |

## Interface Summary

### IContainerExecutor
```typescript
interface IContainerExecutor {
  run(options: ContainerRunOptions): Promise<Result<ContainerResult, EngineError>>;
  runStream(options: ContainerRunOptions, onOutput: OutputCallback): Promise<Result<ContainerResult, EngineError>>;
  isAvailable(): Promise<boolean>;
  isServiceAvailable(service: string): Promise<boolean>;
}
```

### IInputGenerator<TParams>
```typescript
interface IInputGenerator<TParams> {
  generate(modelId: FireModelId, params: TParams): Promise<Result<InputGenerationResult, DomainError>>;
  cleanup(modelId: FireModelId, keepResults?: boolean): Promise<void>;
}
```

### IOutputParser<TOutput>
```typescript
interface IOutputParser<TOutput> {
  parse(workingDir: string): Promise<Result<TOutput, DomainError>>;
  parseLog?(logPath: string): Promise<ExecutionSummary>;
}
```

## Docker Integration

The system uses `docker compose run --rm` to execute FireSTARR:

```bash
docker compose run --rm firestarr-app \
  /appl/firestarr/firestarr \
  /appl/data/sims/{modelId} \
  2024-05-15 \
  55.0 -115.0 12:00 \
  --wx /appl/data/sims/{modelId}/weather.csv \
  --ffmc 85 --dmc 30 --dc 200 \
  -v
```

Volume mounts are configured in `docker-compose.yaml`.

## Stub Execution

When Docker is unavailable, `ModelExecutionService` falls back to stub execution that simulates FireSTARR output:
- Outputs `Running scenario X of 10` patterns
- Reports `Total simulation time was 4.0 seconds`
- Completes in ~4 seconds

## Build Status

✅ `npm run build` passes with no errors
✅ Backend API tested and working
✅ Health, models, and jobs endpoints functional

## Dependencies

**Optional:**
- `gdal-async` - For perimeter rasterization (polygon → TIF)

GDAL is optional - the system gracefully degrades if unavailable. Point ignitions work without GDAL.

## Bug Fixes During Implementation

1. **EngineError constructor**: Changed from `new EngineError(...)` to static factory methods (`EngineError.timeout()`, `EngineError.executionFailed()`)
2. **Unused imports**: Removed unused `ModelResultId`, `FireSTARRCommand`, `basename`, `IFireModelingEngine`, `getFireSTARREngine`
3. **ModelResult instantiation**: Changed from `ModelResult.create({...})` to `new ModelResult({...})`
4. **SpatialGeometry centroid**: Changed from `ignition.centroid` to `ignition.getCentroid()`
5. **GDAL types**: Created `src/types/gdal-async.d.ts` for optional dependency
6. **Date type mismatch**: Added `instanceof Date` check for `createdAt` field

## Notes

- Execution uses in-memory state tracking (lost on restart)
- Weather data is placeholder - real implementation needs SpotWX integration
- FWI indices hardcoded - real implementation needs calculation from weather
- Docker service must be defined in `docker-compose.yaml` as `firestarr-app`
- Perimeter rasterization requires GDAL (optional)

## Next Steps

### Phase 8: Model Results Viewer
- Display probability TIF outputs on map
- Layer opacity controls
- Time-series animation
- Result metadata display

### Or: SpotWX Weather Integration
- Fetch forecast data from SpotWX API
- Calculate FWI indices from weather observations
- Cache weather data for repeated runs
