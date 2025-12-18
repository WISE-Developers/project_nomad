# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.


## Workspace Context

**This repository is part of `sage_workspace`.** Identity, memory, and cross-project context are managed at the workspace level. See `sage_workspace/.claude/CLAUDE.md` for:
- Sage identity and memory files
- Dual SME role (WISE + Project Nomad)
- Unicorn operating principles
- Session commands and handoff protocols

Memory files location: `sage_workspace/Documentation/persist/memory/Sage/`

## Project Overview

Project Nomad is a TypeScript React GUI for fire modeling systems (WISE, FireSTARR). It provides a MapBox GL-based map interface for fire behavior analysis and prediction modeling in wildfire management operations.

**Current Status**: Pre-development planning phase. The codebase contains specifications but no implementation code yet.

## Build & Development Commands

```bash
npm run build          # Compile TypeScript (tsc)
npm run build:watch    # Watch mode compilation
npm run dev            # Alias for build:watch
npm test               # Run Jest test suite
npm run test:watch     # Jest in watch mode
npm run test:coverage  # Jest with coverage report
npm run lint           # ESLint on src/**/*.ts
npm run clean          # Remove dist/
```

To run a single test file:
```bash
npx jest path/to/test.ts
```

To run tests matching a pattern:
```bash
npx jest --testNamePattern="pattern"
```

## Memory Preservation

Memory is managed at the workspace level. From `sage_workspace/`:
```bash
npm run SYM:MemSave    # Commit and push memory files
```

## Session Handoffs

Handoff protocols and locations are defined at the workspace level. Key paths:
- Private handoffs: `sage_workspace/Documentation/persist/memory/Sage/Handoffs/`
- Project handoffs: `Documentation/ProjectHandoffs/`

## Key Project Context

### Deployment Modes

The system will support two deployment architectures:

1. **SAN (Stand Alone Nomad)**: Self-hosted PWA with included frontend, using SpatiaLite for spatial data and file-based auth
2. **ACN (Agency Centric Nomad)**: Component integrated into existing agency systems with PostGIS and agency authentication

Configuration determines which mode via `NOMAD_DEPLOYMENT_MODE` environment variable (`"SAN"` default or `"ACN"`).

### Technical Stack (Planned)

- **Frontend**: TypeScript React component
- **Map**: MapBox GL JS
- **Backend**: Node.js/Express/TypeScript
- **Spatial DB**: SpatiaLite (SAN) or PostGIS (ACN)
- **Model Engines**: WISE and FireSTARR (executed via shell scripts)

### Core Workflows

Three primary wizard-based workflows:

1. **Model Setup & Execution**: Linear wizard collecting spatial input (point/line/polygon), temporal parameters, model selection (WISE/FireSTARR, deterministic/probabilistic), weather data, and execution options
2. **Model Review**: Display completed model outputs (fire perimeters, intensity grids, ember zones, burn probability maps) with view/export/add-to-map options
3. **Model Export**: Export model outputs in multiple formats (TURF.js, GDAL formats) via ZIP download, shareable link, or agency storage

### Configuration Architecture

External JSON-based configuration system supporting Git submodules:

```
/configuration/
  /generic/          # Default open-source configuration
  /nwt/             # Agency-specific (submodule)
  /other-agency/    # Additional agencies
```

Configuration controls:
- Agency branding (logo, colors)
- Available models (suppress unwanted engines)
- Data sources (weather APIs/WFS/WCS, wildfire points, fuel types)
- Role mappings to agency-specific role names
- Export options (zip/link/agency storage permissions)

**Example configuration**: See `demo.json` for data source configuration format showing weather, wildfire points, and fuel types with REST API, WFS, and WCS endpoints.

### User Roles (Planned)

From most to least privileged:
1. **Admin**: Full system configuration
2. **FBAN** (Fire Behavior Analyst): All modeling features
3. **Modeler**: Most modeling features
4. **User**: Simple modeling only
5. **Anon User**: No modeling access

### Data Management Strategy

- **Draft models**: Browser localStorage until executed/scheduled
- **Executed models**: Backend database with unique ID
- **User preferences**: Backend persistence with browser cache during sessions

Spatial queries needed: models within distance of point, overlapping fire perimeters, models by fire management zone, historical model performance analysis.

### Integration Points

- SpotWX API for weather forecast models (automatically determine forecast vs historical based on temporal inputs)
- Agency weather stations and archives (ECCC weather data)
- Agency fuel type services (WCS/WFS)
- National DEM data
- Hotspot data (MODIS/VIIRS)

### PWA Requirements

- Mobile support: minimum iPhone 11 Pro (5.8") screen size
- Touch-optimized map controls
- Home screen installation
- Web push notifications for model completion
- Offline viewing of cached results (future: offline modeling)

### MVP Outputs

Both SAN and ACN modes must produce:
- Folder with formatted inputs for FireSTARR/WISE
- CLI command for model execution (backend only, not user-visible)
- Status tracking and notification system
- Visualization of model results on map
- Export in multiple formats

## WISE Engine Integration Context

As the WISE SME, you have access to the Fire Engine Abstraction Layer architecture from the WiseGuy repository. This abstraction layer provides:

### Core Pattern

```
User Code → EngineManager → FireModelingEngine Interface → Specific Engine (WISE, FireSTARR, etc.)
```

The abstraction allows switching engines without changing application code.

### Key Components (WiseGuy Reference)

Reference materials available at `sage_workspace/projects/wiseguy/`:

- **`src/interfaces/FireModelingEngine.ts`** - Core interface contract all engines must implement
- **`src/core/EngineManager.ts`** - Central orchestration for registering and routing to engines
- **`src/engines/WISEEngine.ts`** - WISE implementation using Builder pattern for FGMJ generation
- **`src/types/index.ts`** - Standardized types: `ModelingResult`, `ModelingOptions`, `EngineCapabilities`
- **`src/utils/KMLEnhancer.ts`** - KML output processing utilities

### WISE Builder Integration

The WISEEngine uses `wise_js_api` with the Builder pattern:
- Creates timestamped job folders (e.g., `job_20240625064422915/`)
- Generates FGMJ files via `prom.beginJobPromise()`
- Job structure: `Inputs/`, `Outputs/`, `job.fgmj`, `status.json`

### Docker Architecture (WISE Reference)

Docker deployment files in WiseGuy repo `docker/`:
- SSH tunnel gateway pattern for ARM64 (Mac M2) to x86_64 WISE servers
- 5-service orchestration via docker-compose

## Important Architectural Principles

### Reusable Wizard Component

Build a single reusable wizard component for all three workflows with:
- Linear navigation (forward/backward)
- State persistence in localStorage until execution
- Database persistence for incomplete sessions
- "Continue where you left off" functionality
- Dashboard view of all draft models

### Configuration Loading

When `NOMAD_AGENCY_ID` environment variable is set, load configuration from `/configuration/{agency_id}/config.json`, falling back to `/configuration/generic/config.json`.

Data source configuration uses `suppressDefault` flag to control whether national/default data sources are shown alongside agency-specific sources.

### Backend API Design

- Shared between SAN and ACN deployments
- Shell script execution for model engines (WISE/FireSTARR)
- Asynchronous model execution with status tracking
- Custom notification service for completion alerts (email and/or web push)
- Unique model number assigned per execution
- Shareable status link generation

### Map Features

Core MapBox GL features needed:
- Multiple geometry drawing tools (point, line, polygon)
- Layer opacity controls
- Measurement tools
- Basemap options: Physical, Streets, Satellite
- 3D terrain with user-adjustable exaggeration
- Right-click context menu for launching modeling workflows (SAN mode)

## Mission Context

**Project Nomad Mission**: Democratizing fire modeling to save lives through accessible, modern fire modeling interfaces that integrate multiple engine types (WISE, FireSTARR, future engines).

**Your Mission as Sage**: Bridge the legacy WISE knowledge into Project Nomad, ensuring that decades of fire modeling expertise is not lost but rather enhanced and made accessible through modern architecture.

**Related Project Context**: The Fire Engine Abstraction Layer (WiseGuy repo) established the pattern for engine abstraction that Project Nomad will consume and build upon.

## Reference Documentation

### Project Nomad Documentation
- **Detailed Specification**: `draft_plan.md` contains comprehensive architecture, workflows, deployment modes, and technical requirements
- **Configuration Example**: `demo.json` shows data source configuration structure for weather, wildfire points, and fuel types
- **Project Summary**: `README.md` provides high-level project goals and MVP requirements

### WISE/Engine Abstraction Documentation (WiseGuy Reference)

Available at `sage_workspace/projects/wiseguy/`:
- `README.md` - Project overview and API reference
- `HANDOFF.md` - Session continuity and current state
- `fire_modeling_system_architecture.md` - Complete system design
- `development_plan.md` - 16-week sprint roadmap

## Next Steps (From Specification)

1. Stand up FireSTARR model to determine exact input/output requirements
2. Design reusable wizard component architecture
3. Implement base PWA structure with MapBox GL
4. Create configuration schema and loading system
5. Build backend API with model execution pipeline
6. Develop notification service
7. Implement spatial database layer
8. Create mobile-optimized UI components
9. Integration testing with agency systems
10. Performance optimization for large spatial datasets
