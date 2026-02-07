# Technology Stack

**Analysis Date:** 2026-02-06

## Languages

**Primary:**
- TypeScript 5.6.3 - Used for all backend and frontend code, ensures type safety across entire project

**Secondary:**
- Python 3 - Used in Docker containers for FireSTARR support libraries (via GDAL/Python bindings)
- Shell/Bash - Used for deployment scripts and container initialization

## Runtime

**Environment:**
- Node.js >=20.0.0 (required)

**Package Manager:**
- npm (monorepo workspaces)
- Lockfile: `package-lock.json` present

## Frameworks

**Core Backend:**
- Express 4.21.0 - HTTP API server framework
- Node.js (runtime)

**Core Frontend:**
- React 18.3.1 - UI component library
- Vite 5.4.10 - Build tool and dev server

**Testing:**
- Vitest 2.1.4 - Test runner for both backend and frontend (replaces Jest)
- @testing-library/react 16.3.1 - React component testing utilities
- @testing-library/jest-dom 6.9.1 - DOM matchers for assertions
- supertest 7.1.4 - HTTP API testing for Express endpoints

**Build/Dev:**
- Vite 5.4.10 - Frontend build and dev server
- Vite Plugin React 4.3.3 - React integration for Vite
- TypeScript Compiler (tsc) 5.6.3 - Backend TypeScript compilation
- tsx 4.19.2 - TypeScript executor for watch mode during development

## Key Dependencies

**Critical Backend:**
- `better-sqlite3` 12.5.0 - Synchronous SQLite driver for SAN (Stand Alone Nomad) mode
- `knex` 3.1.0 - Query builder and migration system, supports: better-sqlite3, PostgreSQL, MySQL, MSSQL, Oracle
- `express` 4.21.0 - Core REST API framework
- `cors` 2.8.5 - Cross-origin resource sharing middleware
- `dotenv` 16.4.5 - Environment variable loading

**Fire Modeling Engines:**
- `cffdrs` (github:cffdrs/cffdrs_ts) - Canadian Fire Weather Index calculations for fire behavior prediction
- `gdal-async` 3.9.3 - Geospatial Data Abstraction Library (async bindings) for raster/vector processing
- `archiver` 7.0.1 - ZIP file generation for model output exports

**Data & Validation:**
- `ajv` 8.17.1 - JSON Schema validator for configuration and API request validation
- `ajv-formats` 3.0.1 - Format validators for ajv (URI, email, etc.)
- `uuid` 13.0.0 - Unique identifier generation for models and jobs

**Logging & Documentation:**
- `winston` 3.17.0 - Structured logging for backend
- `winston-daily-rotate-file` 5.0.0 - Rotating file appender for log aggregation
- `swagger-jsdoc` 6.2.8 - API documentation generator from JSDoc comments
- `swagger-ui-express` 5.0.1 - Interactive API documentation UI at `/api-docs`

**Frontend Map & Geometry:**
- `mapbox-gl` 3.16.0 - Interactive web map library (requires VITE_MAPBOX_TOKEN)
- `@mapbox/mapbox-gl-draw` 1.5.1 - Drawing tools for map geometry (point, line, polygon)
- `@turf/turf` 7.3.1 - Geospatial analysis library for geometry operations
- `react-rnd` 10.5.2 - Resizable, draggable React components for UI layout

**Type Definitions:**
- @types/* packages for all major dependencies (Express, React, Node, MapBox, etc.)

## Configuration

**Environment:**
- Configuration via `.env` file (see `.env.example`)
- Environment-based overrides for: deployment mode, database, API tokens, Docker ports
- Supports: SAN mode (SQLite, simple auth) and ACN mode (PostgreSQL/MySQL/Oracle, OIDC/SAML)

**Build:**
- `frontend/tsconfig.json` - TypeScript config for frontend (React, DOM libs, module resolution)
- `backend/tsconfig.json` - TypeScript config for backend (Node.js, module resolution)
- `frontend/vite.config.ts` - Vite configuration with proxy to backend API
- `frontend/vite.lib.config.ts` - Library build configuration (generates UMD bundle and ES modules)
- `backend/src/core/config/schema/config.schema.json` - JSON Schema for agency configuration validation

## Platform Requirements

**Development:**
- Node.js >=20.0.0
- npm for package management
- Optional: Docker Desktop for FireSTARR container execution
- Optional: PROJ data files for native binary mode coordinate transformations

**Production:**
- Docker deployment (containerized backend, frontend, and FireSTARR services)
- Linux/Debian environment (FireSTARR Docker images built on Debian bookworm)
- For SAN mode: Single host with SQLite database
- For ACN mode: PostgreSQL, MySQL, MSSQL, or Oracle database server
- MapBox GL token for interactive maps

**Optional External Services:**
- SpotWX API for weather forecast data (configured via `configuration/*/config.json`)
- WFS/WCS services for fuel types and wildfire data sources
- REST APIs for weather, wildfire points, and fuel type data

---

*Stack analysis: 2026-02-06*
