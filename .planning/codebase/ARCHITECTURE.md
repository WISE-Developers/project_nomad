# Architecture

**Analysis Date:** 2026-02-06

## Pattern Overview

**Overall:** Clean Architecture with Layered Design + Adapter Pattern

The codebase follows a **multi-tier, decoupled architecture** with clear separation of concerns:
- **Frontend**: React component library with context-based state management and plugin architecture for deployment-mode adaptability
- **Backend**: Layered clean architecture with Domain, Application, and Infrastructure layers
- **Integration**: Deployment-mode-aware (SAN vs ACN) via adapter pattern in the `openNomad` abstraction

**Key Characteristics:**
- Clear domain boundaries between frontend, backend, and fire modeling engines
- Deployment-agnostic API contracts enable both standalone (SAN) and embedded (ACN) deployments
- Use case pattern for application logic isolation
- Result type pattern for functional error handling
- Context-based state management for wizard flows and UI state

## Layers

### Frontend Architecture (React/TypeScript)

**Core Infrastructure Layer:**
- Location: `frontend/src/core/`
- Contains: Deployment mode detection, provider setup, core utilities
- Key files: `DeploymentModeContext.tsx`, `useDeploymentMode.ts`
- Depends on: React Context API, environment variables
- Used by: All feature modules

**Application/Feature Modules Layer:**
- Location: `frontend/src/features/`
- Contains: Feature-specific components, hooks, context, and types
- Structure: Each feature (`Wizard/`, `Map/`, `Dashboard/`, `ModelSetup/`, `ModelReview/`) has parallel structure:
  - `types/`: Domain and component types for the feature
  - `context/`: React Context providers and state management
  - `components/`: React component implementations
  - `hooks/`: Custom hooks for state and side effects
- Depends on: Core infrastructure, openNomad API
- Used by: App component for feature composition

**Integration/Adapter Layer (openNomad):**
- Location: `frontend/src/openNomad/`
- Contains: API contracts, default implementation, customization framework, examples
- Key files:
  - `api.ts`: Interface definitions for all API operations (IOpenNomadAPI)
  - `default/DefaultOpenNomadAPI.ts`: SAN mode reference implementation
  - `context/OpenNomadContext.tsx`: Provider for API singleton
  - `customization/`: Framework for agency-specific customization
  - `examples/`: Integration templates for agencies
- Depends on: Feature modules consume this, not vice versa
- Used by: Dashboard, Wizard, Map components via `useOpenNomad()` hook

**Component Library:**
- Location: `frontend/src/components/`
- Contains: Reusable UI components (SplashScreen, etc.)
- Depends on: Core utilities
- Used by: App and feature modules

**Testing & Mocks:**
- Location: `frontend/src/test/`
- Contains: Test setup, mock implementations for API
- Key files: `setup.ts` for vitest configuration, `mocks/openNomad.ts` for testing

### Backend Architecture (Node.js/Express/TypeScript)

**API/Presentation Layer:**
- Location: `backend/src/api/`
- Contains: Express routers, middleware, request/response handling, Swagger documentation
- Structure:
  - `routes/v1/`: Endpoint implementations (health, config, models, jobs, results, exports)
  - `middleware/`: Auth (simple/ACN), error handling, logging, CORS configuration
  - `swagger.ts`: OpenAPI documentation setup
- Depends on: Application services and use cases
- Used by: Express app initialization in `index.ts`

**Application Layer (Business Logic):**
- Location: `backend/src/application/`
- Contains: Use cases, application services, interfaces defining infrastructure contracts
- Structure:
  - `use-cases/`: Abstract base classes (`UseCase`, `NoInputUseCase`, `CommandUseCase`)
  - `services/`: Application-level services (e.g., model results service)
  - `interfaces/`: Contracts for external dependencies (repositories, engines, services)
  - `common/`: Shared types like `Result<T, E>` for functional error handling
- Key files:
  - `interfaces/IModelExecutionService.ts`: Execution orchestration contract
  - `interfaces/IFireModelingEngine.ts`: Fire modeling engine abstraction
  - `interfaces/IModelRepository.ts`, `IResultRepository.ts`: Data access contracts
  - `common/Result.ts`: Result type for safe error handling
- Depends on: Domain entities and errors
- Used by: API routes invoke services/use cases

**Domain Layer (Business Entities & Rules):**
- Location: `backend/src/domain/`
- Contains: Core entities, value objects, business rules, domain errors
- Structure:
  - `entities/`: FireModel, Job, Result with business logic
  - `value-objects/`: TimeRange, coordinates, enums (EngineType, ModelStatus, JobStatus)
  - `errors/`: DomainError hierarchy (ValidationError, EngineError, NotFoundError)
- Depends on: Nothing else (pure domain)
- Used by: Application layer and infrastructure implementations

**Infrastructure Layer (Technical Details):**
- Location: `backend/src/infrastructure/`
- Contains: Database, file I/O, external service integrations, execution management
- Sub-layers:
  - **Database**: `database/` contains Knex migrations, repositories implementing application interfaces, schema definitions
  - **Config**: `config/` manages environment-based configuration loading for SAN/ACN modes
  - **Execution**: `execution/` handles FireSTARR and native binary process spawning
  - **FireSTARR**: `firestarr/` contains FireSTARR-specific integration logic
  - **Weather**: `weather/` manages weather data fetching (SpotWX, CSV, etc.)
  - **Export**: `export/` handles output formatting (GeoJSON, GDAL formats)
  - **Logging**: `logging/` structured logging with context
  - **Services**: Service factory functions providing singleton instances
  - **Docker**: Docker-specific deployment logic
- Depends on: Application interfaces (implements them)
- Used by: Application layer consumes via interfaces

### Backend Entry Point & Initialization

**Main Entry:** `backend/src/index.ts`
- Initializes Express app with middleware pipeline:
  1. CORS (mode-aware: SAN allows all, ACN restricts to agencies)
  2. JSON body parser (10mb limit for geometry)
  3. Request logging
  4. Authentication (simple or ACN)
- Initializes database and repositories
- Mounts API routers
- Sets up static file serving (production mode) for SPA
- Starts HTTP server on `PORT` (default 3001)

## Data Flow

### Model Creation & Execution Flow

1. **Frontend (User Interaction)**:
   - User opens `ModelSetupWizard` (feature module)
   - Wizard collects: geometry, temporal, model selection, weather config
   - `App.tsx` calls `runModel()` from `services/api.ts`

2. **Frontend → Backend Communication**:
   - `runModel()` makes POST `/api/v1/models/run` with atomic request body
   - Request includes: name, engine type, ignition geometry, time range, weather config, scenarios, output mode
   - Browser auth token automatically attached via fetch interceptor

3. **Backend API Layer**:
   - `models.ts` POST `/models/run` handler receives request
   - Validates all input fields
   - Creates new `FireModel` domain entity with `ModelStatus.Queued`
   - Saves to database via `ModelRepository`

4. **Backend Job Queueing**:
   - `JobQueue` creates job record with model reference
   - Job status: `pending` → `running` → `completed` or `failed`
   - Job ID returned immediately to frontend (async execution)

5. **Backend Execution (Background)**:
   - Job executor picks up queued job
   - `ModelExecutionService` orchestrates execution:
     - Input generation (coordinates → FireSTARR/WISE inputs)
     - Engine execution (spawns process, monitors output)
     - Output parsing (results → GeoJSON/raster)
   - Results saved to database
   - Model status updated to `completed` or `failed`

6. **Frontend Status Monitoring**:
   - `useJobNotifications()` hook subscribes to job status via polling/WebSocket
   - Progress updates displayed in `JobStatusToast`
   - On completion, triggers `ModelReviewPanel`

7. **Results Display & Export**:
   - `ModelReviewPanel` fetches results via `api.results.get(modelId)`
   - Results include: perimeter geometry, intensity grids, probability rasters
   - User can "Add to Map" (invokes `handleAddToMap`) or export

### Spatial Geometry Flow

1. **Drawing (MapBox GL Integration)**:
   - `MapProvider` wraps MapBox GL instance
   - Drawing toolbar activated for point/line/polygon
   - `useDraw()` hook manages drawn features in context
   - Drawn geometry stored in `ModelSetupWizard` state

2. **Map Layers**:
   - `LayerProvider` manages layer registry
   - `addGeoJSONLayer()` and `addRasterLayer()` add model outputs to map
   - Layer panel shows/hides layers with opacity control
   - Each layer has persistence metadata (resultId, outputType)

### Authentication & Deployment Modes

**SAN Mode (Standalone):**
- Backend uses `simpleAuthMiddleware`: expects `Authorization: Bearer <token>` header
- Frontend uses `createDefaultAdapter()` which calls local backend endpoints
- CORS: all origins allowed
- Use case: Self-hosted deployments

**ACN Mode (Agency Centric):**
- Backend uses `acnAuthMiddleware`: validates agency-specific identity
- Environment: `NOMAD_DEPLOYMENT_MODE=ACN`, `NOMAD_AGENCY_ORIGINS_*` vars
- Frontend uses custom agency adapter (implements `IOpenNomadAPI`)
- Agency adapter forwards auth tokens from host application
- CORS: restricted to registered agency origins
- Use case: Embedded in agency systems with existing auth

## Key Abstractions

### IOpenNomadAPI (Frontend Integration Contract)

**Purpose:** Decouples Nomad components from backend implementation

**Examples:** `frontend/src/openNomad/api.ts` defines complete contract:
- `auth`: User and token management
- `models`: CRUD + execution workflow
- `jobs`: Job lifecycle and monitoring
- `results`: Result retrieval, preview URLs, export
- `spatial`: Map drawing, layer management, data services (weather, fuel, elevation)
- `config`: Engine capabilities, agency branding

**Pattern:** Factory pattern creates adapter instances (`createDefaultAdapter()`) bound to feature components via Context (`OpenNomadContext`)

**Usage Example:**
```typescript
const api = useOpenNomad();
const models = await api.models.list({ status: 'completed' });
const job = await api.jobs.submit(modelId);
const unsubscribe = api.jobs.onStatusChange(jobId, (status) => {...});
```

### IFireModelingEngine (Backend Execution Contract)

**Purpose:** Abstracts fire modeling engine differences (FireSTARR, WISE)

**Location:** `backend/src/application/interfaces/IFireModelingEngine.ts`

**Operations:**
- `execute()`: Spawn process with model inputs, monitor, capture outputs
- `getStatus()`: Poll execution progress and logs
- `isAvailable()`: Check if engine binaries exist

**Implementation:** Engine-specific implementations in `infrastructure/firestarr/` handle:
- Input file generation (FGMJ for FireSTARR)
- Process management (spawning, timeouts, cleanup)
- Output parsing (KML → GeoJSON, rasters)

### Use Case Pattern (Backend Application Logic)

**Purpose:** Isolate business logic from framework (Express, database)

**Base Classes:** `backend/src/application/use-cases/UseCase.ts`
- `UseCase<TRequest, TResponse, TError>`: Standard pattern
- `NoInputUseCase<TResponse, TError>`: For queries
- `CommandUseCase<TRequest, TError>`: For operations with no return

**Benefits:**
- Testable without Express or database
- Framework-agnostic
- Single responsibility
- Clear input/output contracts

**Example:** Create model use case would:
1. Validate request against domain rules
2. Create `FireModel` entity
3. Save via injected repository
4. Return `Result.ok(model)` or `Result.fail(error)`

### Result Type Pattern (Functional Error Handling)

**Location:** `backend/src/application/common/Result.ts`

**Purpose:** Replace try/catch with type-safe error handling

**Structure:**
```typescript
Result<T, E> = Success<T> | Failure<E>
// Usage: const result = await useCase.execute(request);
// if (result.success) { /* use result.value */ }
// else { /* handle result.error */ }
```

**Benefits:**
- Compiler ensures error handling
- No hidden exceptions
- Chain operations with `.map()`, `.flatMap()`
- API routes convert to HTTP status codes

### Wizard Component Architecture (Frontend Feature Pattern)

**Location:** `frontend/src/features/Wizard/`

**Pattern:** Reusable wizard with:
- Step-based flow (sequential wizard steps)
- Validation per step
- State persistence (localStorage for drafts, database for saved models)
- Progress tracking
- Callbacks for completion/cancellation

**Structure:**
- `WizardContext`: Manages current step, form data, validation
- `useWizardState`: Hook handling state transitions, localStorage persistence
- `WizardProvider`: Component wrapping wizard + steps
- Step components consume context via `useWizard()` hook

**Concrete Implementation:** `ModelSetupWizard` uses this framework to guide:
1. Geometry selection (draw on map)
2. Temporal parameters (date, time, duration)
3. Model selection (engine, mode)
4. Weather configuration
5. Review & submit

## Entry Points

### Frontend Entry Point

**Location:** `frontend/src/main.tsx`
- React root mount point (calls `createRoot().render()`)
- Calls `App` component

**App Component** (`frontend/src/App.tsx`):
- Initializes provider hierarchy:
  1. `DeploymentModeProvider` (detects SAN vs embedded)
  2. `OpenNomadProvider` with adapter (API communication)
  3. `MapProvider` (MapBox GL instance)
  4. `LayerProvider` (map layer state)
- Renders `AppContent` which orchestrates:
  - Map display with toolbar controls
  - Model setup wizard
  - Model review panel
  - Dashboard with model history
  - Job status notifications

**Application Flow:**
- Splash screen → Main app (map + controls) → User triggers "New Fire Model" → Wizard opens
- Wizard collects input, submits via `runModel()` API call
- Job status monitored via `useJobNotifications()`
- Results displayed in `ModelReviewPanel` when ready

### Backend Entry Point

**Location:** `backend/src/index.ts`
- Loads `.env` from project root
- Initializes database and repositories
- Configures middleware (CORS, auth, logging)
- Mounts API routers at `/api`
- Sets up production static file serving
- Starts Express server on `PORT`

**API Routes** (`backend/src/api/routes/v1/`):
- `health.ts`: `/health`, `/info` - Server status
- `config.ts`: `/config` - Available engines, agency branding
- `models.ts`: `/models/run`, `/models/:id`, `/models/:id/execute` - Model CRUD
- `jobs.ts`: `/jobs/:id` - Job status monitoring
- `results.ts`: `/results/:id/preview`, `/results/:id/download` - Result retrieval
- `exports.ts`: `/exports` - Export formatting and download

**Request Lifecycle:**
1. Request hits middleware pipeline (CORS, auth, logging)
2. Routed to appropriate handler
3. Handler validates input, delegates to services/repositories
4. Response serialized and sent back to frontend

## Error Handling

**Strategy:** Multi-level error handling with clear responsibility

**Patterns:**

**Domain Layer:** Domain errors represent business rule violations:
- `ValidationError`: Input validation failures
- `EngineError`: Fire modeling engine failures
- `NotFoundError`: Resource not found
- `DomainError`: Base class for all domain errors

**Application Layer:** Use cases catch domain errors, wrap in `Result` type:
```typescript
const result = await useCase.execute(request);
if (result.success) { /* process result.value */ }
else { /* handle result.error */ }
```

**API Layer:** Express handlers convert `Result` to HTTP responses:
- `200 OK` for successful operations
- `202 Accepted` for async operations (job submission)
- `400 Bad Request` for validation errors
- `404 Not Found` for missing resources
- `500 Internal Server Error` for unexpected failures

**Frontend Layer:** Components handle API errors via:
- Try/catch blocks in async handlers
- Error state variables displayed to user
- Toast notifications for job failures
- Validation errors in form fields

## Cross-Cutting Concerns

**Logging:** Structured logging via `infrastructure/logging/`
- Context-aware (includes request ID, user ID, operation name)
- Log levels: startup, info, warn, error
- Separate log files for different contexts

**Validation:** Multi-stage validation
- Frontend: Form validation in wizard steps
- Backend API: Input shape validation in route handlers
- Domain: Business rule validation in entities
- Result: Validation errors captured in `Result` type

**Authentication:** Mode-specific auth
- SAN: Bearer token in Authorization header
- ACN: Agency-provided identity with optional token forwarding
- Both modes: User ID extracted and stored with models/jobs

**Performance Considerations:**
- Frontend: State management via Context API (local component re-renders)
- Backend: Database queries scoped to user (no global queries exposed)
- Async processing: Job queue separates model creation from execution

---

*Architecture analysis: 2026-02-06*
