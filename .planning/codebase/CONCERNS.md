# Codebase Concerns

**Analysis Date:** 2026-02-06

## Tech Debt

**Unimplemented Spatial Query Support:**
- Issue: Spatial filtering queries (models within distance of point, overlapping fire perimeters) are stubbed
- Files: `backend/src/infrastructure/database/knex/KnexModelRepository.ts` (line 158-163)
- Impact: Database filtering for spatial operations defaults to non-spatial find; scale-sensitive queries will fetch and filter in-memory
- Fix approach: Implement PostGIS queries for ACN mode and SpatiaLite for SAN mode when spatial extensions are enabled

**WISE Engine Not Yet Implemented:**
- Issue: WISE execution falls back to stub commands for development; real engine integration incomplete
- Files: `backend/src/infrastructure/services/ModelExecutionService.ts` (lines 161-180)
- Impact: WISE models execute but produce no real outputs; FireSTARR is fully operational but WISE remains development placeholder
- Fix approach: Port WISE builder pattern from WiseGuy (sage_workspace/projects/wiseguy/) to nomad_autoforge backend; implement full FGMJ generation pipeline

**Deprecated Database Sync Function:**
- Issue: `initDatabaseSync()` marked deprecated with no migration timeline
- Files: `backend/src/infrastructure/database/Database.ts` (lines 68-73)
- Impact: Codebase may contain legacy sync initialization calls; async/await pattern not consistently applied
- Fix approach: Audit all database initialization call sites; replace with async `initDatabase()` pattern; remove sync function in next major version

**Missing Docker Socket Warning Unresolved:**
- Issue: Docker socket mount documented as requiring "Security Considerations in README" but not clearly addressed
- Files: `docker-compose.yaml` (line 13 comment), README not found with complete security guidance
- Impact: Docker socket exposure in containers creates privilege escalation surface if compromised
- Fix approach: Document socket access limitations, restrict to read-only mount if possible, add runtime user validation

## Known Bugs

**Stub Execution Path Inconsistency:**
- Symptoms: Model execution succeeds but produces no output when Docker/binary not available
- Files: `backend/src/infrastructure/services/ModelExecutionService.ts` (lines 161-180, 182-199)
- Trigger: Run model with FireSTARR when Docker not available or WISE selected
- Workaround: Check engine availability first; error messages logged but not returned to client

**GDAL Command Injection Risk (Mitigated):**
- Symptoms: Static shell command construction could be exploited if file paths not validated
- Files: `backend/src/infrastructure/firestarr/ContourGenerator.ts` (lines 334, 345)
- Current state: File paths generated internally (uuid-based temp files) with no user input; safe by design but pattern fragile
- Recommendations: Add explicit argument validation helper; use GDAL async API instead of CLI when available

## Security Considerations

**Shell Command Execution via child_process.spawn:**
- Risk: Multiple spawn calls throughout codebase for GDAL, docker, and binary execution
- Files:
  - `backend/src/infrastructure/firestarr/ContourGenerator.ts` (execSync for gdal_polygonize, ogr2ogr)
  - `backend/src/infrastructure/docker/DockerExecutor.ts` (spawn for docker compose)
  - `backend/src/infrastructure/nativebinary/NativeBinaryExecutor.ts` (spawn for binary execution)
- Current mitigation: File paths generated internally; args passed as array (not shell-joined); no user shell commands
- Recommendations:
  - Replace execSync with async spawn where possible (ContourGenerator GDAL calls)
  - Add timeout protection for all spawn calls
  - Log all spawned command arguments for audit trail
  - Consider sandboxing approach for native binary execution

**Docker Host Socket Access:**
- Risk: docker-compose.yaml mounts `/var/run/docker.sock` for container management
- Files: `docker-compose.yaml`, `.docker/Dockerfile`
- Impact: Any process in container gains Docker API access; privilege escalation vector if app compromised
- Recommendations:
  - Document socket access requirement in deployment guide
  - Restrict to specific Docker commands via policy
  - Consider alternative: use Docker CLI from host instead of socket mount
  - Add container user validation (non-root execution confirmed in Dockerfile)

**Environment Variable Exposure:**
- Risk: Docker spawn inherits process.env including potentially sensitive vars
- Files: `backend/src/infrastructure/docker/DockerExecutor.ts` (line 112)
- Current state: Selective deletion of FIRESTARR_DATASET_PATH when using host.env, but pattern not systematic
- Recommendations:
  - Build whitelist of safe vars to pass instead of blacklist deletion
  - Document which env vars are passed to containers
  - Use secure secrets management (not process.env) for API keys

**Deprecated Packages in Dependencies:**
- Risk: package-lock.json shows deprecated dependencies (glob v9, others)
- Files: `package-lock.json` (lines 8368, 8731, 9567, 9574, 12255, 12280, 12300, 14120)
- Impact: Security patches may not be available; transitive vulnerability chains possible
- Fix approach: Update all direct dependencies to latest; audit transitive deps; configure Dependabot

## Performance Bottlenecks

**Synchronous GDAL Command Execution:**
- Problem: execSync calls block event loop during contour generation
- Files: `backend/src/infrastructure/firestarr/ContourGenerator.ts` (lines 335, 346, 447)
- Cause: gdal_polygonize, ogr2ogr, gdalinfo run sequentially via execSync
- Impact: Raster processing stalls entire backend; concurrent requests slow dramatically
- Improvement path:
  - Migrate to async spawn with streaming output
  - Implement queue for GDAL operations (max 2-3 parallel)
  - Use GDAL async API (gdal-async) instead of CLI shells
  - Add progress callbacks for UI streaming

**In-Memory Data Processing:**
- Problem: Entire raster data loaded into Float32Array for contour generation
- Files: `backend/src/infrastructure/firestarr/ContourGenerator.ts` (lines 80-131)
- Cause: Quantile break calculation iterates all pixels; no chunking
- Impact: Large rasters (>5000x5000px) consume GB of memory; no streaming tile support
- Improvement path:
  - Implement streaming tile-based contour generation
  - Use GDAL VRT for virtual raster slicing
  - Move quantile calculation to GDAL histogram API
  - Add memory usage monitoring/limits

**Frontend Large Component Files:**
- Problem: Several React components exceed 800+ lines
- Files:
  - `frontend/src/openNomad/api.ts` (1061 lines)
  - `frontend/src/openNomad/default/DefaultOpenNomadAPI.ts` (1051 lines)
  - `frontend/src/features/Dashboard/components/DashboardContainer.tsx` (815 lines)
  - `frontend/src/features/Map/context/LayerContext.tsx` (648 lines)
  - `frontend/src/App.tsx` (618 lines)
- Impact: Single component handles multiple concerns; testing fragile; refactoring risky
- Improvement path:
  - Extract API routing logic from implementation (decorator pattern)
  - Split Dashboard into smaller feature components
  - Migrate LayerContext state to Zustand or Jotai
  - Break App.tsx into layout/routing/provider hierarchy

**Database Query N+1 Issues:**
- Problem: Spatial model queries fall back to non-spatial; likely fetching all models in memory
- Files: `backend/src/infrastructure/database/knex/KnexModelRepository.ts` (line 158-163)
- Impact: Dashboard model list with 1000+ records becomes slow; pagination doesn't improve query time
- Improvement path:
  - Implement PostGIS/SpatiaLite queries for efficient spatial filtering
  - Add database indexes on status, engineType, userId, createdAt
  - Implement cursor-based pagination instead of limit/offset

## Fragile Areas

**GDAL Output Parsing:**
- Files: `backend/src/infrastructure/firestarr/ContourGenerator.ts`, `backend/src/infrastructure/firestarr/FireSTARROutputParser.ts`
- Why fragile: Parsing GDAL/FireSTARR JSON and GeoJSON output with regex patterns; whitespace/format changes break silently
- Safe modification:
  - Add schema validation (zod/yup) for all GDAL output
  - Log full output on parse failure for debugging
  - Add unit tests with real GDAL/FireSTARR output samples
- Test coverage: GeoJSON parsing tested but GDAL shell output parsing untested

**Raster Tile Caching:**
- Files: `backend/src/infrastructure/firestarr/ContourGenerator.ts` (tileCache, rasterMetadataCache)
- Why fragile: Two separate in-memory caches with no invalidation strategy; no persistence layer
- Safe modification:
  - Implement cache key versioning (include file hash)
  - Add cache size limits with LRU eviction
  - Add cache hit/miss metrics
- Test coverage: No cache lifecycle tests

**Model Execution Process Tracking:**
- Files: `backend/src/infrastructure/services/ModelExecutionService.ts` (processes Map)
- Why fragile: In-memory process map lost on server restart; orphaned processes not cleaned up
- Safe modification:
  - Persist execution state to database (status, logs, timestamps)
  - Add process cleanup handler on SIGTERM
  - Implement stale job detection and cleanup (findStaleModels method exists but cleanup not implemented)
- Test coverage: No integration tests for process lifecycle

**Docker Compose Volume Mounting:**
- Files: `backend/src/infrastructure/docker/DockerExecutor.ts` (buildDockerArgs)
- Why fragile: Volume mount construction assumes consistent file paths; breaks if run from container
- Safe modification:
  - Test both host and container execution modes
  - Validate host.env file format
  - Add volume path normalization/validation
- Test coverage: No Docker compose execution tests

## Scaling Limits

**Raster Processing Memory:**
- Current capacity: ~100-500MB per raster (depends on tile count)
- Limit: 2GB memory limit per Node.js process
- Scaling path:
  - Implement streaming tile generation (process 256x256 tiles independently)
  - Use child processes for raster ops (separate memory spaces)
  - Add memory monitoring and rejection of oversized rasters

**Spatial Query Performance:**
- Current capacity: ~1000 models per query (acceptable with pagination)
- Limit: Without spatial indexes, query time grows O(n) with model count
- Scaling path:
  - Enable PostGIS spatial indexes (CREATE INDEX on geometry column)
  - Implement bounding box pre-filter before detailed spatial query
  - Add database query plan analysis and optimization

**Concurrent Job Execution:**
- Current capacity: Single JobQueue with no parallelization limits
- Limit: GDAL/FireSTARR sequential execution blocks at container/binary level
- Scaling path:
  - Implement job queue with configurable worker pool
  - Add per-engine concurrency limits (e.g., max 2 FireSTARR jobs)
  - Use Worker Threads for CPU-intensive operations
  - Monitor job queue depth and add backpressure

**Frontend Component Re-render Performance:**
- Current capacity: Dashboard renders 50+ models without virtualization
- Limit: O(n) component count causes frame drops on slower devices
- Scaling path:
  - Implement react-window for model list virtualization
  - Add pagination controls (20 items/page)
  - Memoize model list row component
  - Profile re-renders with React DevTools

## Dependencies at Risk

**Deprecated child_process Usage Pattern:**
- Risk: execSync in modern Node.js flagged for deprecation; no async replacement immediately available
- Files: `backend/src/infrastructure/firestarr/ContourGenerator.ts`
- Impact: GDAL operations block event loop; future Node.js versions may remove sync APIs
- Migration plan: Use spawn with streaming output instead; migrate ContourGenerator to async/await fully

**GDAL Binding Instability:**
- Risk: gdal-async npm package shows limited maintenance; C++ bindings break across Node versions
- Files: Multiple imports of gdal-async
- Impact: npm install may fail on new Node/OS versions; binary rebuild required
- Alternative: Use GDAL CLI exclusively (done for most operations) or migrate to pure-JS solutions (if performance acceptable)

**REACT_APP_ Environment Variables Removed:**
- Risk: Build process no longer supports REACT_APP_ pattern; migration to Vite complete but tooling assumes old pattern
- Files: Documentation not found clarifying env var handling in Vite
- Impact: Developers expecting REACT_APP_ won't find build-time injection
- Fix approach: Document Vite env var pattern (import.meta.env.VITE_) clearly in README

## Missing Critical Features

**Test Coverage Severe Gap:**
- What's missing: Only 5 test files identified (.test.ts/.spec.ts) in entire codebase
- Files: Core business logic largely untested (FireSTARREngine, ContourGenerator, ModelRepository, API routes)
- Blocks:
  - Refactoring engine abstractions safely
  - Validating output format changes
  - Ensuring error handling correctness
- Test implementation needed:
  - Unit tests for domain entities and value objects (80%+ coverage target)
  - Integration tests for fire model execution pipeline
  - API contract tests for all v1 endpoints
  - GDAL output parsing with real command results

**WISE Integration Missing:**
- What's missing: Complete WISE engine execution pipeline (setup, input generation, job management, output parsing)
- Files: `backend/src/infrastructure/services/ModelExecutionService.ts` shows stub fallback
- Blocks:
  - Multi-engine parity (FireSTARR only)
  - User selection of modeling approach
  - Comparative analysis workflows
- Implementation needed:
  - Port FGMJ builder from WiseGuy to Nomad backend
  - Implement WISE process spawning with proper timeout/error handling
  - Create WISE output parser (FBP files to GeoJSON)
  - Add WISE to engine availability checks

**Webhook/Notification System Incomplete:**
- What's missing: Model completion notifications; status polling required instead of push
- Files: Job tracking exists in database but no outbound notification mechanism
- Blocks:
  - Real-time UI updates
  - Email/SMS alerts on completion
  - Integration with agency systems
- Implementation needed:
  - Define webhook/event interface
  - Implement database event log
  - Add retry mechanism for delivery failures
  - Support multiple notification channels

**Raster Visualization Limits:**
- What's missing: Interactive raster manipulation (opacity, threshold adjustment) requires client-side re-render
- Files: Frontend raster display code
- Blocks:
  - Real-time probability threshold adjustment
  - Uncertainty visualization
  - Performance sensitivity analysis
- Implementation needed:
  - Add raster shader controls (WebGL)
  - Implement client-side raster rescaling
  - Add threshold slider for dynamic contour generation

## Test Coverage Gaps

**API Routes:**
- What's not tested: All v1 route handlers (models, results, exports, jobs) for happy path and error cases
- Files: `backend/src/api/routes/v1/*.ts` (models.ts, results.ts, exports.ts, jobs.ts)
- Risk: Request/response transformation bugs, auth bypass, validation gaps undetected
- Priority: **High** - routes are primary integration surface

**Fire Model Execution Pipeline:**
- What's not tested: Model creation → execution → result persistence full workflow
- Files: FireSTARREngine → ModelExecutionService → JobQueue → ModelRepository chain
- Risk: Silent failures in output handling; results not persisted correctly; users see no indication
- Priority: **High** - core workflow

**GDAL Output Parsing:**
- What's not tested: gdal_polygonize, ogr2ogr, gdalinfo command results with real output data
- Files: `backend/src/infrastructure/firestarr/ContourGenerator.ts` (parseGeoJSON, getRasterBounds, getRasterValueRange)
- Risk: Format changes in GDAL versions break silently; invalid geometry not caught
- Priority: **Medium** - currently works but fragile to upgrades

**Database Repository:**
- What's not tested: KnexModelRepository.find() with various filter combinations; pagination
- Files: `backend/src/infrastructure/database/knex/KnexModelRepository.ts`
- Risk: Query bugs only discovered in production; spatial query fallback not tested
- Priority: **Medium** - mostly works but edge cases unknown

**Frontend Error Handling:**
- What's not tested: API error responses; network failures; timeout handling in OpenNomadContext
- Files: `frontend/src/openNomad/default/DefaultOpenNomadAPI.ts`, Dashboard component
- Risk: Error states not properly displayed to users; recovery behavior untested
- Priority: **Medium** - affects user experience

**Configuration Loading:**
- What's not tested: Configuration schema validation; submodule fallback logic; agency config merging
- Files: `backend/src/infrastructure/config/ConfigurationLoader.ts`
- Risk: Invalid config silently defaults; agency customizations lost; missing validation
- Priority: **Medium** - impacts all agency deployments

---

*Concerns audit: 2026-02-06*
