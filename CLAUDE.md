# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Project Nomad is a TypeScript React GUI for fire modeling systems (WISE, FireSTARR). It provides a MapBox GL-based map interface for fire behavior analysis and prediction modeling in wildfire management operations.

**Current Status**: Pre-development planning phase. The codebase contains specifications but no implementation code yet.

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

## Reference Documentation

- **Detailed Specification**: `draft_plan.md` contains comprehensive architecture, workflows, deployment modes, and technical requirements
- **Configuration Example**: `demo.json` shows data source configuration structure for weather, wildfire points, and fuel types
- **Project Summary**: `README.md` provides high-level project goals and MVP requirements

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
