# External Integrations

**Analysis Date:** 2026-02-06

## APIs & External Services

**Fire Modeling Engines:**
- FireSTARR - Probabilistic fire behavior model execution
  - SDK/Client: Docker image `ghcr.io/cwfmf/firestarr-cpp/firestarr:latest` or native binary
  - Execution: Via `docker compose run` (ephemeral containers) or native binary
  - Config: `FIRESTARR_EXECUTION_MODE` (docker|binary), `FIRESTARR_BINARY_PATH`, `FIRESTARR_DATASET_PATH`
  - Output: Probability grids, perimeter files, simulation logs in `/appl/data/sims/{jobId}/`
  - Status: Fully integrated in backend (`src/infrastructure/firestarr/FireSTARREngine.ts`)

- WISE - Fire behavior prediction engine
  - SDK/Client: Not yet implemented (stub execution in place)
  - Status: Defined in architecture but pending integration
  - Config: Already parsed from `configuration/*/config.json` engines array
  - Placeholder: `src/infrastructure/services/ModelExecutionService.ts` lines 163-165

**Weather Data:**
- SpotWX API - Forecast and historical weather data
  - Use: Triggered for temporal inputs during model setup wizard
  - Config: Defined in `configuration/*/config.json` under `dataSources.weather`
  - Type: REST API
  - Status: Configuration placeholder (actual HTTP client integration pending)

- Manual Weather Input - User-provided weather parameters
  - Use: Alternative to SpotWX for offline or custom scenarios
  - Input format: Wind speed (km/h), wind direction (°), temperature (°C), humidity (%)
  - Processing: Converted to weather CSV via `src/infrastructure/firestarr/WeatherCSVWriter.ts`

**Geospatial Data Services:**
- WCS (Web Coverage Service) - Raster data for fuel types and DEM
  - Config: `configuration/*/config.json` under `dataSources.fuelTypes` with `kind: "WCS"`
  - Client: GDAL via `gdal-async` for coordinate transformation and raster queries
  - Format: GeoTIFF rasters for fuel classification grids

- WFS (Web Feature Service) - Vector data for wildfire points and boundaries
  - Config: `configuration/*/config.json` under `dataSources.wildfirePoints` with `kind: "WFS"`
  - Format: GeoJSON/GML features

- REST APIs - Generic data endpoints
  - Config: `configuration/*/config.json` with `kind: "REST"`
  - Client: Browser `fetch()` for CORS-safe cross-origin requests

## Data Storage

**Databases:**
- SQLite (SAN mode - default)
  - Client: `better-sqlite3` 12.5.0
  - Connection: File at `{NOMAD_DATA_PATH}/nomad.db` (default: `{FIRESTARR_DATASET_PATH}/nomad.db`)
  - Migrations: `src/infrastructure/database/migrations/` (001_create_tables, 002_add_user_ownership)
  - Tables: `fire_models`, `jobs`, `model_results` with user ownership support

- PostgreSQL (ACN mode)
  - Client: `knex` with `pg` driver
  - Connection: `NOMAD_DB_HOST:NOMAD_DB_PORT/NOMAD_DB_NAME`
  - Auth: `NOMAD_DB_USER` / `NOMAD_DB_PASSWORD`
  - SSL: Optional via `NOMAD_DB_SSL` (true|false)
  - Pool: Min `NOMAD_DB_POOL_MIN` (default: 2), Max `NOMAD_DB_POOL_MAX` (default: 10)

- MySQL / MySQL 2 (ACN mode option)
  - Client: `knex` with `mysql` or `mysql2` driver
  - Connection: `NOMAD_DB_HOST:NOMAD_DB_PORT/NOMAD_DB_NAME`
  - Auth: `NOMAD_DB_USER` / `NOMAD_DB_PASSWORD`

- SQL Server / MSSQL (ACN mode option)
  - Client: `knex` with `mssql` driver
  - Connection: `NOMAD_DB_HOST:NOMAD_DB_PORT/NOMAD_DB_NAME`
  - Auth: `NOMAD_DB_USER` / `NOMAD_DB_PASSWORD`
  - Encryption: Controlled via `NOMAD_DB_SSL`

- Oracle Database (ACN mode option)
  - Client: `knex` with `oracledb` driver
  - Connection: `NOMAD_DB_HOST:NOMAD_DB_PORT/NOMAD_DB_NAME`
  - Auth: `NOMAD_DB_USER` / `NOMAD_DB_PASSWORD`

**File Storage:**
- FireSTARR Dataset - Local filesystem
  - Path: `FIRESTARR_DATASET_PATH` (required, absolute path)
  - Structure: `/generated/grid/100m/{year|default}/fuel_*.tif`, `/sims/` for job working directories
  - Docker mount: Same path mounted in backend and firestarr-app containers

- Model Outputs - Local filesystem during processing
  - Location: `{FIRESTARR_DATASET_PATH}/sims/{jobId}/`
  - Files: Input CSVs, settings.ini, output TIFFs, logs
  - Lifetime: Persisted for results review and re-export

- Exports - ZIP archives
  - Generated: `src/infrastructure/export/ZipGenerator.ts` using `archiver`
  - Contents: GeoJSON, KML, Shapefiles, and metadata
  - Delivery: HTTP download or shareable link (TBD: link storage backend)

**Caching:**
- Browser localStorage - Draft model state (before execution)
- Server-side database - Model metadata, results, user preferences

## Authentication & Identity

**Auth Provider:**
- None / Simple (SAN mode - default)
  - Implementation: `src/api/middleware/simpleAuth.ts`
  - Mechanism: Username-based simple auth on splash screen
  - Environment: `VITE_SIMPLE_AUTH=true` enables UI prompt
  - User context: Attached to models for ownership tracking

- OIDC (OpenID Connect - ACN mode)
  - Config: `configuration/*/config.json` under `auth.oidc`
  - Fields: `issuer`, `clientId`, `clientSecret`, `scopes`, `authorizationEndpoint`, `tokenEndpoint`, `userInfoEndpoint`
  - Role mapping: `auth.roleMappings` maps external roles to internal roles (admin, fban, modeler, user, anonymous)
  - Implementation: `src/api/middleware/acnAuth.ts` (pending full implementation)

- SAML 2.0 (ACN mode)
  - Config: `configuration/*/config.json` under `auth.saml`
  - Fields: `idpMetadataUrl`, `spEntityId`, `acsUrl`, `sloUrl`, `certificate`
  - Role mapping: Via `auth.roleMappings` array
  - Implementation: Structure in place, pending provider integration

**Authorization:**
- Role-based access control (RBAC)
  - Internal roles: admin, fban (Fire Behavior Analyst), modeler, user, anonymous
  - Permissions per role: Defined in `configuration/*/config.json` under `roles[].permissions`
  - Enforced: Via `@nomad/backend` middleware (not yet visible in samples)

## Monitoring & Observability

**Error Tracking:**
- None - No third-party error tracking service integrated
- Local logging: Winston logger writes to console and daily-rotating files

**Logs:**
- Format: Winston structured logging
  - Appenders: Console (development), daily-rotating files (`winston-daily-rotate-file`)
  - Location: Configurable via environment (default: logs directory)
  - Levels: debug, info, warn, error
  - Modules: Separate logging for backend services, engines, execution

- API Documentation:
  - Format: OpenAPI 3.0.0 via `swagger-jsdoc`
  - UI: Swagger UI at `/api-docs` (via `swagger-ui-express`)
  - Generation: JSDoc comments in route files (`src/api/routes/v1/*.ts`)

**Health Checks:**
- Endpoint: `GET /health` (`src/api/routes/v1/health.ts`)
- Returns: Uptime, database status, engine availability (FireSTARR, WISE), deployment mode
- Status: Overall healthy/degraded based on database connectivity

## CI/CD & Deployment

**Hosting:**
- Docker-based containerized deployment
  - Images: nomad-backend (Node.js), nomad-frontend (Nginx/static), firestarr-app (custom compiled)
  - Orchestration: `docker-compose.yaml` and `docker-compose.dev.yaml`
  - Repository: CWFMF firestarr-cpp for FireSTARR Docker images (ghcr.io registry)

**CI Pipeline:**
- None detected - No GitHub Actions, GitLab CI, or other CI service configured
- Manual: `npm run build` and `npm run build:backend` / `npm run build:frontend` for builds

## Environment Configuration

**Required env vars:**
- `VITE_MAPBOX_TOKEN` - MapBox GL access token (must be obtained from account.mapbox.com)
- `FIRESTARR_DATASET_PATH` - Absolute path to FireSTARR data directory (fuel grids, DEM, sims)
- `FIRESTARR_DATASET_SOURCE` - URL or local path to download FireSTARR dataset ZIP
- `NOMAD_DEPLOYMENT_MODE` - Deployment architecture: "SAN" (default) or "ACN"

**Optional env vars (ACN mode):**
- `NOMAD_AGENCY_ID` - Agency identifier for configuration loading from `/configuration/{id}/`
- `NOMAD_DB_CLIENT` - Database type: `pg`, `mysql`, `mysql2`, `mssql`, `oracledb` (default: `pg`)
- `NOMAD_DB_HOST`, `NOMAD_DB_PORT`, `NOMAD_DB_NAME`, `NOMAD_DB_USER`, `NOMAD_DB_PASSWORD`
- `NOMAD_DB_SSL` - Enable SSL/TLS for database (true|false)
- `NOMAD_DB_POOL_MIN`, `NOMAD_DB_POOL_MAX` - Connection pool size

**Optional env vars (FireSTARR execution):**
- `FIRESTARR_EXECUTION_MODE` - Execution method: `docker` (default) or `binary`
- `FIRESTARR_BINARY_PATH` - Path to FireSTARR native binary (required if mode=binary)
- `FIRESTARR_IMAGE` - Custom Docker image URL for FireSTARR (defaults to ghcr.io/cwfmf/firestarr-cpp/firestarr:latest)
- `PROJ_DATA` - Path to PROJ data files for coordinate transformations (only for binary mode)

**Frontend env vars:**
- `VITE_API_BASE_URL` - Backend API URL (default: http://localhost:4901/)
- `VITE_DEV_PORT` - Frontend dev server port (default: 5177)
- `VITE_API_PORT` - Backend API port for proxy (default: 4901)
- `VITE_SIMPLE_AUTH` - Enable simple username auth UI (default: true)

**Secrets location:**
- `.env` file (not committed to git, see `.gitignore`)
- Environment variables passed via Docker compose or deployment platform

## Webhooks & Callbacks

**Incoming:**
- None - No inbound webhooks from external services

**Outgoing:**
- None - No outbound webhook notifications (planned: web push and email notifications via custom service in `src/application/services/NotificationService`)

## Data Source Configuration

**Pattern:**
Data sources are defined in JSON configuration files (`configuration/*/config.json`) with support for multiple providers and types.

**Example structure:**
```json
{
  "dataSources": {
    "weather": [
      {
        "id": "spotwx",
        "name": "SpotWX",
        "urls": ["https://api.spotwx.com/..."],
        "type": "API",
        "kind": "REST",
        "isDefault": true
      }
    ],
    "wildfirePoints": [
      {
        "id": "modis",
        "name": "MODIS Hotspots",
        "urls": ["https://wfs.example.com/..."],
        "type": "OWS",
        "kind": "WFS",
        "isDefault": true
      }
    ],
    "fuelTypes": [
      {
        "id": "national-dem",
        "name": "National DEM",
        "urls": ["https://wcs.example.com/..."],
        "type": "OWS",
        "kind": "WCS",
        "isDefault": true
      }
    ]
  }
}
```

**Types:**
- `API` - HTTP REST endpoints
- `OWS` - OGC Web Services (WFS, WCS)

**Kinds:**
- `REST` - Generic REST API
- `WFS` - Web Feature Service (vector data)
- `WCS` - Web Coverage Service (raster data)

---

*Integration audit: 2026-02-06*
