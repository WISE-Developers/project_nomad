<p align="center">
  <img src="assets/logo/nomad-logo.png" alt="Project Nomad Logo" width="200"/>
</p>

<p align="center">
  <img src="assets/screenshots/Screenshot_mvp_v0.png" alt="Screenshot" width="1200"/>
</p>

# Project Nomad

A national fire modeling GUI system for Canadian wildfire management.

## Mission

Democratizing fire modeling to save lives through accessible, modern interfaces that integrate multiple fire behavior prediction engines.

## Overview

Project Nomad is a TypeScript React GUI for fire modeling systems (WISE, FireSTARR). It provides a MapBox GL-based map interface for fire behavior analysis and prediction modeling in wildfire management operations.

**Current Status**: Phase 1 MVP Complete. Working SAN deployment with FireSTARR integration, full visualization pipeline, and installer for easy deployment.

## Deployment Modes

### SAN (Stand Alone Nomad)
Self-hosted PWA for individual users or small teams:
- Bundled frontend with local backend
- SpatiaLite for spatial data storage
- File-based authentication
- Ideal for field operations or standalone deployments

### ACN (Agency Centric Nomad)
Component integrated into existing agency infrastructure:
- Embeddable React component
- PostGIS spatial database integration
- Protocol-based authentication (OIDC/OAuth 2.0, SAML 2.0)
- Configuration via Git submodules for agency-specific branding and data sources

**For ACN integration, see [EMBEDDING.md](EMBEDDING.md)** - complete guide for embedding the dashboard in your agency's application.

## Fire Modeling Engines

### FireSTARR (Primary)
Open-source probabilistic fire modeling:
- Monte Carlo simulation for burn probability
- Canadian FBP System implementation
- Fast C++ execution
- Active development

### WISE (Legacy Support)
Deterministic fire growth modeling:
- Prometheus heritage (Huygens wavelet propagation)
- Production-proven in Canadian agencies
- Integration via Fire Engine Abstraction Layer
- Transition path to FireSTARR

## Core Features (Planned)

**Model Setup Wizard**
- Ignition input (point, line, polygon drawing on map)
- Temporal configuration (start time, duration)
- Engine selection (WISE/FireSTARR, deterministic/probabilistic)
- Weather data integration (SpotWX, agency stations)

**Model Review**
- Fire perimeter visualization on MapBox GL
- Intensity grids, burn probability maps
- Time-stepped animation
- Export to multiple formats

**Data Sources**
- National fuel type grids
- National DEM
- ECCC weather data
- MODIS/VIIRS hotspots
- Agency-specific data via configuration

## Technical Stack

| Component | Technology |
|-----------|------------|
| Frontend | TypeScript, React |
| Map | MapBox GL JS |
| Backend | Node.js, Express, TypeScript |
| Spatial DB | SpatiaLite (SAN) / PostGIS (ACN) |
| Model Engines | FireSTARR, WISE (via abstraction layer) |

## Documentation

### Component Embedding
For agencies integrating the Nomad dashboard into existing applications:
- **[EMBEDDING.md](EMBEDDING.md)** - Consumer entry point for embedding
- **[openNomad/README.md](frontend/src/openNomad/README.md)** - Complete adapter implementation guide
- **[docs/examples/](docs/examples/)** - Runnable integration examples

### SME Documentation
Comprehensive technical references for fire modeling integration:

- **FireSTARR**: `Documentation/Research/SME_Data/FireSTARR/`
- **WISE**: `Documentation/Research/SME_Data/WISE/`

### Project Specification
- `draft_plan.md` - Detailed architecture and workflow specification

### Configuration
- `demo.json` - Example data source configuration

## Project Structure

```
project_nomad/
├── frontend/
│   └── src/
│       ├── App.tsx           # Main orchestration
│       ├── features/         # Feature modules
│       │   ├── Map/          # MapBox GL integration
│       │   ├── Wizard/       # Reusable wizard component
│       │   ├── ModelSetup/   # Fire model setup workflow
│       │   ├── ModelReview/  # Results visualization
│       │   ├── Dashboard/    # Draft models management
│       │   ├── Export/       # Output export
│       │   └── Notifications/# Job status notifications
│       ├── openNomad/        # Embeddable component API
│       │   ├── api.ts        # IOpenNomadAPI interface
│       │   ├── customization/# White-label theming
│       │   ├── default/      # SAN mode implementation
│       │   └── examples/     # Integration examples
│       ├── services/         # API communication
│       ├── components/       # Shared components
│       └── shared/utils/     # Utilities
├── backend/
│   └── src/                  # Express API server
├── docs/
│   └── examples/             # Runnable integration examples
│       ├── react-minimal/    # React + Vite example
│       └── vanilla-js/       # UMD script tag example
├── Documentation/
│   └── persist/
│       └── SMEKB/Nomad/      # SME Knowledge Base
│           └── plan/
│               ├── nomad_master_plan.md
│               └── SST/      # Single Source of Truth diagrams
├── EMBEDDING.md              # Component embedding guide
├── assets/logo/              # Project branding
└── configuration/            # Agency configuration
```

## System Requirements

### Backend
- **Node.js** >= 20.0.0
- **GDAL** native libraries (for raster processing)

#### Installing GDAL

**macOS (Homebrew):**
```bash
brew install gdal
```

**Ubuntu/Debian:**
```bash
sudo apt-get install gdal-bin libgdal-dev
```

**Docker:** The backend Dockerfile includes GDAL automatically.

## Docker Deployment

```bash
docker compose build
docker compose up -d
```

### Security Considerations

**Docker Socket Mount Warning**: The backend container mounts the host's Docker socket (`/var/run/docker.sock`) to spawn FireSTARR model containers. This grants the backend container **root-equivalent access to the host machine**.

Implications:
- Any process with Docker socket access can start privileged containers
- Can mount arbitrary host filesystem paths
- Effectively allows container escape

**Recommendations:**
- Only deploy in trusted network environments
- Do not expose the backend directly to the public internet without additional hardening
- Consider a reverse proxy with authentication for production deployments
- For high-security environments, implement a job queue architecture where a dedicated worker (outside the container) handles model execution

This architecture is acceptable for:
- Local development
- Internal agency deployments behind firewalls
- Trusted research environments

## Development

```bash
npm run build          # Compile TypeScript
npm run dev            # Watch mode
npm test               # Run tests
npm run lint           # ESLint
```

## MVP Outputs

Both deployment modes produce:
- Formatted input folder for FireSTARR/WISE
- CLI command for model execution
- Status tracking and notifications
- Visualization on map
- Export in standard GIS formats

## Related Projects

- **WiseGuy**: Fire Engine Abstraction Layer
  - Provides engine abstraction for WISE integration
  - Pattern for multi-engine support

## Contributing

Project Nomad is in early planning. Contact the maintainers for collaboration opportunities.

## License

TBD

---

*Project Nomad - Making fire modeling accessible to those who need it most.*
