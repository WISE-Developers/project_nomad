# Codebase Structure

**Analysis Date:** 2026-02-06

## Directory Layout

```
nomad_autoforge/
├── frontend/                    # React/TypeScript frontend (SPA)
│   ├── src/
│   │   ├── main.tsx            # React root entry point
│   │   ├── App.tsx             # Main app component and orchestration
│   │   ├── index.css           # Global styles
│   │   ├── core/               # Core infrastructure
│   │   │   ├── deployment/     # Deployment mode detection and context
│   │   │   └── index.ts        # Core exports
│   │   ├── components/         # Reusable UI components
│   │   ├── features/           # Feature modules (Wizard, Map, Dashboard, etc.)
│   │   │   ├── Wizard/
│   │   │   ├── Map/
│   │   │   ├── Dashboard/
│   │   │   ├── ModelSetup/
│   │   │   ├── ModelReview/
│   │   │   └── Notifications/
│   │   ├── openNomad/          # API integration layer (adapter pattern)
│   │   │   ├── api.ts          # IOpenNomadAPI interface definition
│   │   │   ├── context/        # OpenNomadContext provider
│   │   │   ├── default/        # SAN mode reference implementation
│   │   │   ├── customization/  # Agency customization framework
│   │   │   ├── examples/       # Integration templates for agencies
│   │   │   └── index.ts        # Exports and factory functions
│   │   ├── services/           # API client functions
│   │   └── test/               # Testing utilities and mocks
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts          # Vite build config
│   ├── vitest.config.ts        # Vitest test runner config
│   └── dist/                   # Built output (production)
│
├── backend/                     # Node.js/Express backend
│   ├── src/
│   │   ├── index.ts            # Express app entry point and initialization
│   │   ├── api/                # API layer (Express routers & middleware)
│   │   │   ├── routes/
│   │   │   │   ├── v1/         # Versioned API endpoints
│   │   │   │   │   ├── index.ts
│   │   │   │   │   ├── health.ts       # Health checks
│   │   │   │   │   ├── config.ts       # Configuration endpoint
│   │   │   │   │   ├── models.ts       # Model CRUD and execution
│   │   │   │   │   ├── jobs.ts         # Job status monitoring
│   │   │   │   │   ├── results.ts      # Result retrieval
│   │   │   │   │   └── exports.ts      # Export functionality
│   │   │   │   └── index.ts
│   │   │   ├── middleware/     # Express middleware
│   │   │   │   ├── index.ts
│   │   │   │   ├── auth.ts     # Auth middleware (simple & ACN)
│   │   │   │   ├── errorHandler.ts
│   │   │   │   └── requestLogger.ts
│   │   │   ├── swagger.ts       # OpenAPI/Swagger documentation
│   │   │   └── index.ts
│   │   ├── application/        # Business logic layer (use cases, services)
│   │   │   ├── use-cases/      # Use case base classes
│   │   │   │   ├── UseCase.ts
│   │   │   │   └── index.ts
│   │   │   ├── services/       # Application services
│   │   │   │   ├── ModelResultsService.ts
│   │   │   │   └── index.ts
│   │   │   ├── interfaces/     # Service contracts
│   │   │   │   ├── IModelExecutionService.ts
│   │   │   │   ├── IFireModelingEngine.ts
│   │   │   │   ├── IModelRepository.ts
│   │   │   │   ├── IResultRepository.ts
│   │   │   │   ├── IJo bRepository.ts
│   │   │   │   ├── IJobQueue.ts
│   │   │   │   ├── IConfigurationService.ts
│   │   │   │   ├── ISpatialRepository.ts
│   │   │   │   ├── IWeatherRepository.ts
│   │   │   │   ├── IInputGenerator.ts
│   │   │   │   ├── IOutputParser.ts
│   │   │   │   ├── IEnvironmentService.ts
│   │   │   │   ├── IContainerExecutor.ts
│   │   │   │   └── index.ts
│   │   │   ├── common/         # Shared types
│   │   │   │   ├── Result.ts   # Result<T, E> type for functional error handling
│   │   │   │   └── index.ts
│   │   │   └── index.ts
│   │   ├── domain/             # Business entities and rules
│   │   │   ├── entities/       # Domain entities (FireModel, Job, Result)
│   │   │   ├── value-objects/  # Value objects (TimeRange, enums, etc.)
│   │   │   ├── errors/         # Domain error types
│   │   │   └── index.ts
│   │   ├── infrastructure/     # Technical implementations
│   │   │   ├── database/       # Database layer
│   │   │   │   ├── index.ts
│   │   │   │   ├── knex/       # Knex query builder setup
│   │   │   │   ├── migrations/ # Database migrations
│   │   │   │   └── repositories/ # Repository implementations
│   │   │   ├── config/         # Configuration loading
│   │   │   │   ├── schema/     # Config schema validation
│   │   │   │   └── index.ts
│   │   │   ├── execution/      # Process execution and job queue
│   │   │   │   ├── JobQueue.ts
│   │   │   │   ├── ModelExecutionService.ts
│   │   │   │   └── index.ts
│   │   │   ├── firestarr/      # FireSTARR engine integration
│   │   │   │   ├── FireSTARREngine.ts
│   │   │   │   ├── validators/ # FireSTARR-specific validators
│   │   │   │   └── index.ts
│   │   │   ├── weather/        # Weather data services
│   │   │   │   ├── types.ts    # Weather configuration types
│   │   │   │   └── index.ts
│   │   │   ├── export/         # Output format conversion
│   │   │   │   ├── formatters/ # Format-specific converters
│   │   │   │   └── index.ts
│   │   │   ├── logging/        # Structured logging
│   │   │   │   ├── Logger.ts
│   │   │   │   └── index.ts
│   │   │   ├── services/       # Service singletons and factories
│   │   │   │   ├── index.ts
│   │   │   │   └── JobQueue.ts
│   │   │   ├── nativebinary/   # Native binary detection/execution
│   │   │   ├── docker/         # Docker deployment logic
│   │   │   └── index.ts
│   │   ├── types/              # Global type definitions
│   │   └── index.ts
│   ├── dist/                   # Compiled output
│   ├── package.json
│   ├── tsconfig.json
│   └── knexfile.ts             # Knex database configuration
│
├── configuration/              # Application configuration (JSON)
│   ├── generic/                # Default configuration (open-source)
│   │   └── config.json
│   ├── nwt/                    # Agency-specific config (submodule example)
│   └── demo.json               # Data source configuration reference
│
├── docker/                     # Docker build files
├── .docker/                    # Docker compose development setup
├── scripts/                    # Build and utility scripts
├── tools/                      # Development tools
├── .planning/                  # Planning and analysis (git-ignored)
│   └── codebase/              # Codebase analysis documents
├── Documentation/              # Project documentation
├── docs/                       # Generated documentation
├── assets/                     # Static assets
├── firestarr_test_data/       # Test data for FireSTARR
│
├── package.json               # Root workspace package.json
├── package-lock.json
├── docker-compose.yaml        # Production deployment
├── docker-compose.dev.yaml    # Development deployment
│
├── .env.example               # Environment variable template
├── .gitignore
├── .eslintrc*                 # ESLint configuration
├── .prettier*                 # Prettier formatting configuration
├── README.md
├── QUICKSTART.md
├── project-plan.md
├── EMBEDDING.md
├── LICENSE
└── AGPLv3_impact.md
```

## Directory Purposes

**frontend/** - TypeScript React single-page application
- Purpose: User-facing fire modeling interface with map visualization
- Key exports: React components, hooks, context providers
- Build output: `dist/` (Vite build artifacts)
- Served by backend in production mode

**backend/** - Node.js Express REST API server
- Purpose: Fire model orchestration, job execution, data persistence
- Handles: Request routing, authentication, database access, engine orchestration
- Build output: `dist/` (TypeScript compiled to ESM JavaScript)
- Runs on port 3001 (default)

**configuration/** - JSON-based feature flags and data sources
- Purpose: Agency-specific customization without code changes
- Structure: `generic/` for defaults, agency-named folders for overrides
- Usage: Backend loads `${NOMAD_AGENCY_ID}/config.json` at startup
- Key content: Available models, data source URLs, export formats, UI branding

**docker/** - Container definitions
- Purpose: Containerized deployment for both SAN and ACN modes
- Contents: Dockerfile for multi-stage builds, docker-compose orchestration

**scripts/** - Build and development automation
- Purpose: NPM scripts for building, testing, deployment
- Run via: `npm run [script-name]`

**Documentation/** - Project specifications and guidelines
- Purpose: Architecture docs, integration guides, standards
- Key files: `project-plan.md`, `EMBEDDING.md`, `draft_plan.md`

## Key File Locations

### Entry Points

**Frontend:**
- `frontend/src/main.tsx` - React root mount
- `frontend/src/App.tsx` - Main application component (orchestrator)

**Backend:**
- `backend/src/index.ts` - Express server initialization and startup

### Configuration

**Frontend:**
- `frontend/tsconfig.json` - TypeScript compiler options (target ES2022, path aliases `@/*`)
- `frontend/vite.config.ts` - Build tool configuration
- `frontend/vitest.config.ts` - Test runner configuration

**Backend:**
- `backend/tsconfig.json` - TypeScript compiler options (target ES2022, ESM output)
- `backend/knexfile.ts` - Database connection and migration configuration
- `backend/src/infrastructure/config/schema/` - Configuration validation schemas

**Root:**
- `.env.example` - Template for environment variables (SAN and ACN modes)
- `docker-compose.yaml` - Production deployment configuration
- `docker-compose.dev.yaml` - Development environment setup

### Core Logic

**Frontend:**
- `frontend/src/App.tsx` - Component orchestration, state coordination
- `frontend/src/features/*/context/` - Feature state management (Context + hooks)
- `frontend/src/features/Wizard/` - Multi-step form wizard implementation
- `frontend/src/features/Map/` - MapBox GL integration and drawing tools
- `frontend/src/openNomad/api.ts` - API contract definition
- `frontend/src/openNomad/default/DefaultOpenNomadAPI.ts` - SAN mode implementation

**Backend:**
- `backend/src/api/routes/v1/models.ts` - Model creation, status, execution (41KB - main endpoint)
- `backend/src/api/routes/v1/results.ts` - Result retrieval and preview URLs
- `backend/src/infrastructure/execution/ModelExecutionService.ts` - Job orchestration
- `backend/src/infrastructure/firestarr/FireSTARREngine.ts` - Fire modeling engine adapter
- `backend/src/infrastructure/database/repositories/` - Data access implementations
- `backend/src/infrastructure/weather/` - Weather data integration

### Testing

**Frontend:**
- `frontend/src/test/setup.ts` - Vitest configuration and test utilities
- `frontend/src/test/mocks/openNomad.ts` - Mock API implementation for tests
- `frontend/src/**/__tests__/` or `frontend/src/**/*.test.tsx` - Test files (co-located)

**Backend:**
- `backend/src/api/__tests__/` - API route tests
- `backend/src/infrastructure/config/__tests__/` - Configuration tests
- `backend/src/infrastructure/deployment/__tests__/` - Deployment logic tests

## Naming Conventions

### Files

**React Components:** PascalCase + `.tsx` extension
- `ModelSetupWizard.tsx`, `DrawingToolbar.tsx`, `MapContainer.tsx`
- Co-located in feature directory: `features/Wizard/components/WizardStep.tsx`

**Hooks:** camelCase with `use` prefix + `.ts` or `.tsx`
- `useWizard.ts`, `useMap.ts`, `useDraw.ts`, `useJobNotifications.ts`
- Located in `features/*/hooks/`

**Context:** PascalCase + `Context.tsx`
- `WizardContext.tsx`, `MapContext.tsx`, `OpenNomadContext.tsx`

**Types:** camelCase for files, PascalCase for exported interfaces
- `types/index.ts` exports `WizardContextValue`, `MapLayerStyle`

**Services:** PascalCase + `Service.ts` or `Repository.ts`
- Backend: `ModelExecutionService.ts`, `ModelRepository.ts`
- Frontend: `api.ts` (special case - API contract file)

**Tests:** Same name as source + `.test.ts` or `.test.tsx`
- `ModelSetupWizard.test.tsx`, `FireSTARREngine.test.ts`

**Utilities:** camelCase + `.ts`
- `getBoundsFromGeoJSON.ts`, `validateWeatherData.ts`

**Configuration:** lowercase + `.json` or `.ts`
- `config.json` (application config), `knexfile.ts` (database config)

### Directories

**Feature Modules:** lowercase with hyphens if multi-word (matches kebab-case feature names)
- `ModelSetup/`, `ModelReview/`, `Notifications/`
- Contains parallel structure: `components/`, `context/`, `hooks/`, `types/`

**Infrastructure:** lowercase, domain-specific names
- `database/`, `firestarr/`, `weather/`, `export/`, `logging/`

**Domain Layer:** lowercase, conceptual groupings
- `entities/`, `value-objects/`, `errors/`

### Type Names

**Domain Entities:** PascalCase
- `FireModel`, `Job`, `ModelResult`

**Value Objects:** PascalCase
- `TimeRange`, `Coordinates`, `ModelStatus` (enum)

**Errors:** PascalCase + `Error` suffix
- `ValidationError`, `EngineError`, `NotFoundError`

**API Types:** PascalCase
- `Model`, `Job`, `ModelCreateParams`, `ExecutionStatus`

**Function Parameters:** camelCase
- `modelId`, `engineType`, `timeRange`

## Where to Add New Code

### New Feature (Complete Feature Module)

**Primary code:**
- `frontend/src/features/{FeatureName}/` with structure:
  - `components/` - React component files
  - `context/` - State management via Context
  - `hooks/` - Custom hooks for state/side effects
  - `types/index.ts` - Type definitions

**Tests:**
- Co-locate in `frontend/src/features/{FeatureName}/components/__tests__/`

**Integration:**
- Import feature module in `App.tsx`
- Add to provider hierarchy if state needed

**Example:** To add a "Model Comparison" feature:
```
frontend/src/features/ModelComparison/
├── components/
│   ├── ComparisonPanel.tsx
│   ├── MetricsTable.tsx
│   └── __tests__/
├── context/
│   ├── ComparisonContext.tsx
│   └── useComparison.ts
├── hooks/
│   └── useComparisonData.ts
└── types/
    └── index.ts
```

### New Backend Service/Dependency

**Interface Definition:**
- `backend/src/application/interfaces/INewService.ts`

**Implementation:**
- `backend/src/infrastructure/{domain}/NewService.ts`

**Factory Registration:**
- Export singleton from `backend/src/infrastructure/services/index.ts`
- Import and use in API routes via factory function

**Example:** To add a new email notification service:
```
backend/src/application/interfaces/IEmailService.ts (contract)
backend/src/infrastructure/services/EmailService.ts (implementation)
backend/src/infrastructure/services/index.ts (export getEmailService)
backend/src/api/routes/v1/jobs.ts (inject via getEmailService())
```

### New API Endpoint

**Route Handler:**
- Add function in `backend/src/api/routes/v1/{resource}.ts`
- Use `asyncHandler()` wrapper for automatic error handling
- Structure: validation → service call → response serialization

**Documentation:**
- Add JSDoc with `@openapi` tags for Swagger
- Define request/response schemas

**Middleware:**
- Use existing middleware (`simpleAuthMiddleware`, `requireRoles()`)
- Or add new middleware in `backend/src/api/middleware/`

**Example:** To add a bulk export endpoint:
```typescript
router.post(
  '/exports/bulk',
  asyncHandler(async (req, res) => {
    const body = req.body as BulkExportRequest;
    // Validation
    // Service call
    // Serialization
    res.status(202).json({ jobId, ... });
  })
);
```

### New Component Library Entry

**Location:** `frontend/src/components/{ComponentName}.tsx`

**Pattern:**
- Export single component with clear props interface
- No feature-specific logic (reusable)
- Import and use in features or App.tsx

**Example:** To add a status badge component:
```
frontend/src/components/StatusBadge.tsx
// Exports: StatusBadge component
// Used in: ModelReviewPanel, Dashboard, etc.
```

### Shared Utilities

**Location:** `frontend/src/services/` (frontend) or spread across `backend/src/` (backend)

**Frontend Services:**
- `api.ts` - API client functions (wraps openNomad)
- Other service files: `authService.ts`, `storageService.ts`

**Backend Services:**
- Infrastructure: `backend/src/infrastructure/{domain}/`
- Common: `backend/src/application/common/`

## Special Directories

**.planning/codebase/** - Codebase analysis (git-ignored)
- Purpose: Analysis documents for future work
- Generated: Yes (via GSD analysis commands)
- Committed: No (in .gitignore)

**firestarr_test_data/** - FireSTARR test fixtures
- Purpose: Sample inputs/outputs for testing
- Generated: No (checked in)
- Committed: Yes

**assets/** - Static resources
- Purpose: Images, icons, fonts
- Generated: No
- Committed: Yes

**dist/** (both frontend and backend) - Build artifacts
- Purpose: Compiled output
- Generated: Yes (`npm run build`)
- Committed: No (in .gitignore)

**node_modules/** - Dependencies
- Purpose: Installed npm packages
- Generated: Yes (`npm install`)
- Committed: No (in .gitignore)

---

*Structure analysis: 2026-02-06*
