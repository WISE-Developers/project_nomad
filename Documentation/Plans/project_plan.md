<p align="center">
  <img src="../../assets/logo/nomad-logo.png" alt="Project Nomad Logo" width="200"/>
</p>

# Project Nomad - Detailed Specification

## Executive Summary

Project Nomad is a TypeScript React component that provides a comprehensive GUI for fire modeling systems (WISE, FireSTARR, and future engines). It serves as the primary user interface for all modeling in the NWT IntelliFire system and will be the foundation for a national prototype for all agencies and public use.

The system features a map-based interface using MapBox GL, with two deployment modes:
- **SAN (Stand Alone Nomad)**: Self-hosted with included frontend
- **ACN (Agency Centric Nomad)**: Integrated into agency systems

## Core Use Cases

The system supports all major fire management operational needs:
- Initial attack planning
- Long-term fire growth projections
- Real-time situational awareness during active incidents
- Pre-season planning and risk assessment

## Target Users

- Fire behavior analysts at provincial/territorial level
- Local fire management officers  
- ICS planning section personnel during incidents
- Research and training applications
- Public users (limited features)

## Architecture Overview

### Deployment Modes

#### Stand Alone Nomad (SAN)
- Packaged as a Progressive Web App (PWA)
- Includes its own MapBox GL host application
- Docker compose deployment option
- Simple file-based authentication
- Uses SpatiaLite for spatial database needs
- Right-click context menu for launching modeling workflows

#### Agency Centric Nomad (ACN)
- Integrates into existing agency systems (e.g., IntelliFire EasyMap3)
- Uses agency authentication systems
- Integrates with agency spatial databases (PostGIS)
- Launched via cross-linking from various entry points

### Technical Stack

- **Frontend**: TypeScript React Component
- **Map Engine**: MapBox GL JS
- **Backend API**: Node.js/Express/TypeScript
- **Spatial Database**: 
  - SAN: SpatiaLite (Spatial SQLite)
  - ACN: PostGIS/GeoServer integration
- **Model Engines**: WISE, FireSTARR (executed via shell scripts)
- **PWA Features**: Offline capability, installable, push notifications

### Architecture Principles

All code in Project Nomad **must** conform to Uncle Bob's Clean Architecture and SOLID principles. These are non-negotiable requirements that govern how every component is structured.

#### Clean Architecture

The codebase follows a layered architecture with strict dependency rules:

```
┌─────────────────────────────────────────────────────────────┐
│                    Frameworks & Drivers                      │
│  (React, MapBox GL, Express, SpatiaLite/PostGIS, Docker)    │
├─────────────────────────────────────────────────────────────┤
│                    Interface Adapters                        │
│  (Controllers, Presenters, Gateways, API Routes)            │
├─────────────────────────────────────────────────────────────┤
│                       Use Cases                              │
│  (Application Business Rules - Workflows, Model Execution)  │
├─────────────────────────────────────────────────────────────┤
│                        Entities                              │
│  (Enterprise Business Rules - Fire Models, Spatial Data)    │
└─────────────────────────────────────────────────────────────┘
```

**The Dependency Rule**: Source code dependencies must point **inward only**. Nothing in an inner circle can know anything about something in an outer circle. This means:

- Entities know nothing about Use Cases, Adapters, or Frameworks
- Use Cases know about Entities, but nothing about Adapters or Frameworks
- Interface Adapters know about Use Cases and Entities, but not Framework specifics
- Frameworks & Drivers are the outermost layer and can know about everything inward

**Practical Application in Nomad**:

| Layer | Nomad Components |
|-------|------------------|
| Entities | `FireModel`, `SpatialGeometry`, `WeatherData`, `FuelType`, `ModelResult` |
| Use Cases | `ExecuteModelUseCase`, `ExportResultsUseCase`, `ConfigureWeatherUseCase` |
| Interface Adapters | API controllers, MapBox adapters, database repositories, presenter classes |
| Frameworks | React components, Express routes, MapBox GL, SpatiaLite/PostGIS drivers |

#### SOLID Principles

**S - Single Responsibility Principle**
> A class should have one, and only one, reason to change.

Each module handles one concern. A `WeatherService` fetches weather data - it doesn't also validate geometries or format exports. When requirements change for weather fetching, only weather-related code changes.

**O - Open/Closed Principle**
> Software entities should be open for extension, but closed for modification.

New fire modeling engines (beyond WISE/FireSTARR) are added by implementing the `FireModelingEngine` interface, not by modifying existing engine code. New export formats extend the export system without changing existing exporters.

**L - Liskov Substitution Principle**
> Subtypes must be substitutable for their base types.

Any implementation of `FireModelingEngine` (WISE, FireSTARR, future engines) must be usable interchangeably. Code that works with the base interface must work correctly with any implementation without knowing which specific engine it's using.

**I - Interface Segregation Principle**
> Clients should not be forced to depend on interfaces they do not use.

Small, focused interfaces over large monolithic ones. A component that only needs to read model results shouldn't depend on an interface that also includes model execution methods. Split into `ModelReader` and `ModelExecutor` interfaces.

**D - Dependency Inversion Principle**
> High-level modules should not depend on low-level modules. Both should depend on abstractions.

The `ExecuteModelUseCase` doesn't depend on `WISEEngine` directly - it depends on the `FireModelingEngine` abstraction. The concrete engine is injected at runtime. This enables:
- Swapping engines without changing business logic
- Testing use cases with mock engines
- Supporting SAN vs ACN database implementations transparently

#### Directory Structure (Clean Architecture)

```
src/
├── domain/                    # Entities - innermost layer
│   ├── entities/
│   │   ├── FireModel.ts
│   │   ├── SpatialGeometry.ts
│   │   └── WeatherData.ts
│   └── value-objects/
│       ├── Coordinates.ts
│       └── TimeRange.ts
├── application/               # Use Cases
│   ├── use-cases/
│   │   ├── execute-model/
│   │   ├── export-results/
│   │   └── configure-weather/
│   └── interfaces/            # Abstractions for outer layers
│       ├── IFireModelingEngine.ts
│       ├── IWeatherRepository.ts
│       └── ISpatialRepository.ts
├── infrastructure/            # Interface Adapters & Frameworks
│   ├── adapters/
│   │   ├── mapbox/
│   │   ├── spatialite/
│   │   └── postgis/
│   ├── engines/
│   │   ├── wise/
│   │   └── firestarr/
│   └── api/
│       ├── controllers/
│       └── routes/
└── presentation/              # React UI (Framework layer)
    ├── components/
    ├── pages/
    └── hooks/
```

#### Testing Strategy (Clean Architecture)

- **Entities**: Pure unit tests, no mocks needed
- **Use Cases**: Unit tests with mocked repository/engine interfaces
- **Adapters**: Integration tests with real databases/services
- **Frameworks**: E2E tests for React components and API routes

This separation allows testing business logic independently of frameworks, databases, and external services.

### Configuration System

External JSON-based configuration with Git submodule support:
```
/configuration/
  /generic/          # Default open-source configuration
  /nwt/             # NWT-specific configuration (submodule)
  /other-agency/    # Other agency configurations
```

#### Configuration Structure Example

```json
{
  "agency": {
    "id": "nwt",
    "name": "Government of Northwest Territories",
    "branding": {
      "logo": "/config/nwt/logo.png",
      "primaryColor": "#234075"
    }
  },
  "models": {
    "available": ["firestarr", "wise"],
    "suppress": ["other_model"]
  },
  "dataSources": {
    "weather": {
      "suppressDefault": false,
      "sources": [
        {
          "name": "NWT Weather Data API",
          "url": ["https://nwt-weather-api.gov.nt.ca"],
          "type": "API",
          "kind": "REST"
        },
        {
          "name": "NWT Historical Weather Data Archive",
          "url": ["https://nwt-archive/geoserver/weather/wfs"],
          "type": "OWS",
          "kind": "WFS"
        }
      ]
    },
    "wildfirePoints": {
      "suppressDefault": false,
      "sources": [
        {
          "name": "NWT Wildfire Points API",
          "url": ["https://nwt-wildfire-api.gov.nt.ca"],
          "type": "API",
          "kind": "REST"
        },
        {
          "name": "NWT Wildfire Polygon Data WFS",
          "url": ["https://nwt-geoserver.gov.nt.ca/geoserver/wildfire/polygon/wfs"],
          "type": "OWS",
          "kind": "WFS"
        }
      ]
    },
    "fuelTypes": {
      "suppressDefault": false,
      "sources": [
        {
          "name": "NWT Fuel Types WCS",
          "url": ["https://nwt-geoserver.gov.nt.ca/geoserver/fueltypes/WCS"],
          "type": "OWS",
          "kind": "WCS"
        }
      ]
    }
  },
  "roleMapping": {
    "fire_manager": "FBAN",
    "ops_staff": "Modeler"
  },
  "exportOptions": {
    "allowZipDownload": true,
    "allowShareableLink": true,
    "allowAgencyStorage": true
  }
}
```

## Workflows

### 1. Model Setup & Execution Workflow

A linear wizard interface that collects all necessary inputs:

1. **Spatial Input**
   - Pass geometry via crosslink (point, line, or polygon)
   - Draw geometry on map
   - Upload geometry file (GeoJSON, Shapefile, KML)
   - Manual lat/long entry

2. **Temporal Parameters**
   - Start date and time
   - Model duration

3. **Model Selection**
   - Choose engine (WISE, FireSTARR, others)
   - Model type (deterministic vs probabilistic)

4. **Weather Data**
   - Automatic determination of forecast vs historical based on temporal inputs
   - Selection of weather model via SpotWX API
   - Models available based on location and time

5. **Review & Execute**
   - Summary of all inputs
   - Options: Back (modify), Start (execute now), Defer (schedule for later)
   - Unique model number assigned
   - Email and/or web push notification preferences
   - Shareable status link generated

### 2. Model Review Workflow

Triggered when a model run completes:

1. **Summary Display**
   - Reminder of input parameters
   - List of generated outputs

2. **Output Interaction**
   - Eye icon: View output in popup map
   - Export icon: Add to export workflow
   - Option to add layers to main map

3. **Output Types** (vary by model and type)
   - Fire perimeters at time steps
   - Intensity grids
   - Ember zones
   - Burn probability maps (probabilistic runs)
   - Rate of spread data

### 3. Model Export Workflow

Context-sensitive export system:

1. **Export Selection**
   - Pre-populated with selected output
   - Add additional outputs to bundle

2. **Format Selection**
   - TURF.js supported formats
   - GDAL supported formats

3. **Delivery Method**
   - Direct ZIP download
   - Shareable link
   - Agency storage (ACN mode)
   - Admin configurable restrictions

## User Roles & Permissions

Hierarchy from most to least privileged:
1. **Admin** - Full system configuration access
2. **FBAN** (Fire Behavior Analyst) - All modeling features
3. **Modeler** - Most modeling features
4. **User** - Simple modeling only
5. **Anon User** - No modeling access

## Data Management

### Storage Strategy

- **Draft Models**: Browser localStorage until executed/scheduled
- **Executed Models**: Backend database with unique ID
- **User Preferences**: 
  - Backend for persistence
  - Browser cache during active sessions
  - Sync on session end

### Spatial Capabilities

Required spatial queries include:
- Models within distance of point
- Overlapping fire perimeters
- Models by fire management zone
- Historical model performance analysis

## Map Features

### Core MapBox GL Features
- Multiple geometry drawing tools
- Layer opacity controls
- Measurement tools
- Basemap options: Physical, Streets, Satellite

### 3D Visualization
- Terrain with user-adjustable exaggeration
- Topographic analysis for fire behavior
- MapBox terrain layer for MVP

## PWA Features

### Mobile Support
- Minimum screen size: iPhone 11 Pro (5.8")
- Full wizard interface optimized for mobile
- Touch-optimized map controls

### Progressive Capabilities
- Home screen installation
- Web push notifications for model completion
- Offline viewing of cached results (future offline modeling planned)

## Development Considerations

### Environment Variables
- `NOMAD_DEPLOYMENT_MODE`: "SAN" (default) or "ACN"
- `NOMAD_AGENCY_ID`: Agency identifier when in ACN mode

### Wizard Component
- Reusable across all three workflows
- Linear navigation with forward/backward
- State persisted in localStorage until execution
- Database persistence for incomplete sessions
- "Continue where you left off" functionality
- Dashboard view of all draft models

### Backend API
- Node.js/Express/TypeScript
- Shared between SAN and ACN deployments
- Shell script execution for model engines
- Asynchronous model execution with status tracking
- Custom notification service for completion alerts

### Integration Points
- SpotWX API for weather forecast models
- Agency weather stations and archives
- ECCC weather data
- Agency fuel type services (WCS/WFS)
- National DEM data
- Hotspot data (MODIS/VIIRS)

## MVP Outputs

Both deployment modes produce:
- Folder with formatted inputs for FireSTARR/WISE
- CLI command for model execution (backend only, not user-visible)
- Status tracking and notification system
- Visualization of model results
- Export in multiple formats

## Future Enhancements

- Offline model execution capability
- Real-time model progress updates
- GPU-accelerated modeling
- Advanced parameter tuning interface
- Model validation and QA workflows
- Integration with additional fire behavior models
- Enhanced 3D visualization features

## Deployment Options

### Stand Alone (SAN)
- Docker compose configuration
- Bare metal installation
- PWA deployment

### Agency Centric (ACN)  
- Component integration into existing systems
- API endpoint configuration
- Role mapping to agency authentication
- Custom data source integration

## Success Metrics

- Support for concurrent model runs
- Model execution time optimization
- Mobile device compatibility
- Cross-agency configuration flexibility
- User role-based feature availability
- Spatial query performance

---

## Implementation Progress

### Phase 3: Frontend Architecture

#### Sprint 2: Dashboard & openNomad (Dec 2024)

**Status**: Complete

##### Issue #108: openNomad API Interface
- Created `IOpenNomadAPI` interface with 6 modules: auth, models, jobs, results, spatial, config
- Defines all types for communication between Dashboard and backend
- Template for agency-specific adapters

##### Issue #110: Default openNomad Implementation (SAN)
- `OpenNomadProvider` React context for API access
- `createDefaultAdapter()` factory wrapping services/api.ts
- Heavily commented as agency implementation template
- Subscription management for job status polling

##### Issue #109: Extract Dashboard Component
- **DashboardContext**: Centralized state management with reducer pattern
- **Dashboard Hooks**: useModels, useJobs, useResults (all using openNomad API)
- **Dashboard Components**:
  - `DashboardContainer`: Floating (SAN) and embedded (ACN) modes
  - `ModelList`: Filter, sort, search, bulk operations
  - `ModelCard`: Individual model display with actions
  - `StatusMonitor`: Active job tracking with progress bars
- **App.tsx Integration**: Replaced inline models list with Dashboard

**Architecture**:
```
Dashboard Component <--> useOpenNomad() <--> IOpenNomadAPI <--> Backend
                                                ^
                                    Agency adapters implement this
```

---

## Next Steps

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