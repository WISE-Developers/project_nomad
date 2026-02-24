<p align="center">
  <img src="assets/logo/nomad-logo.png" alt="Project Nomad Logo" width="200"/>
</p>

<p align="center">
  <img src="assets/screenshots/Screenshot_mvp_v0.png" alt="Screenshot" width="1200"/>
</p>

# Project Nomad

A national fire modeling GUI system for Canadian wildfire management.

## Mission

Democratizing fire modeling to save lives through accessible, modern interfaces.

## Overview

Project Nomad is a TypeScript React GUI for fire modeling. It provides a MapBox GL-based map interface for fire behavior analysis and prediction modeling in wildfire management operations.

**Current Status**: Phase 1 MVP Complete. Working SAN deployment with FireSTARR integration, full visualization pipeline, and installer for easy deployment.

## Deployment

### SAN (Stand Alone Nomad)
Self-hosted application for individual users or small teams:
- Bundled frontend with local backend
- SQLite for data storage
- Simple file-based authentication
- Container or Metal (bare metal) infrastructure modes
- Ideal for field operations or standalone deployments

### ACN (Agency Centric Nomad)
Component integrated into existing agency systems:
- Nomad dashboard embedded as a React component
- Agency-managed authentication and backend
- PostGIS or other agency database
- See [EMBEDDING.md](EMBEDDING.md) for integration guide

## Fire Modeling Engine

### FireSTARR
Open-source probabilistic fire modeling:
- Monte Carlo simulation for burn probability
- Canadian FBP System implementation
- Fast C++ execution
- Active development

## Core Features

**Model Setup Wizard**
- Ignition input (point drawing on map)
- Temporal configuration (start time, duration)
- Weather data integration (SpotWX)

**Model Review**
- Fire perimeter visualization on MapBox GL
- Burn probability maps
- Time-stepped animation
- Export to multiple formats

**Data Sources**
- National fuel type grids
- National DEM
- ECCC weather data
- MODIS/VIIRS hotspots

## Technical Stack

| Component | Technology |
|-----------|------------|
| Frontend | TypeScript, React |
| Map | MapBox GL JS |
| Backend | Node.js, Express, TypeScript |
| Database | SQLite |
| Model Engine | FireSTARR |
| Infrastructure | Container or Metal (bare metal) |

## System Requirements

| Component | Minimum | Details |
|-----------|---------|---------|
| **Nomad** | 2 cores, 4 GB RAM, 2 GB disk | [Full requirements](NOMAD_REQUIREMENTS.md) |
| **FireSTARR** | 2 cores, 8 GB RAM, 50 GB disk (dataset) | [Full requirements](FIRESTARR_REQUIREMENTS.md) |

Container mode requires a Docker-compatible API and Docker Compose v2. Bare metal mode requires Node.js >= 20, GDAL, and SQLite. See the requirements documents for complete details.

## Documentation

### Component Embedding
For embedding the Nomad dashboard in external applications:
- **[EMBEDDING.md](EMBEDDING.md)** - Consumer entry point for embedding
- **[openNomad/README.md](frontend/src/openNomad/README.md)** - Complete adapter implementation guide
- **[docs/examples/](docs/examples/)** - Runnable integration examples

### SME Documentation
Technical references for fire modeling:
- **FireSTARR**: `Documentation/Research/SME_Data/FireSTARR/`

## Project Structure

```
project_nomad/
├── frontend/                  # React TypeScript frontend
├── backend/                   # Express API server
├── scripts/                   # Installer and setup scripts
├── docker/                    # Container build files
├── configuration/             # Agency configuration (generic/ ships with repo; agencies may use submodules)
├── docs/examples/             # Integration examples (React, vanilla JS)
├── Documentation/             # SME knowledge base and project docs
├── NOMAD_REQUIREMENTS.md      # Nomad system requirements
├── FIRESTARR_REQUIREMENTS.md  # FireSTARR system requirements
├── EMBEDDING.md               # Guide for embedding Nomad in other apps
├── install.sh                      # Run this to install
├── docker-compose.yaml        # Container deployment
└── docker-compose.dev.yaml    # Development deployment
```

## Installation

The interactive installer handles all configuration and dependencies:

```bash
git clone https://github.com/WISE-Developers/project_nomad.git
cd project_nomad
./install.sh
```

The installer will guide you through:
1. **Infrastructure selection** - Container (recommended) or Metal (bare metal)
2. **FireSTARR dataset** - Download or use existing (~50GB national fuel/DEM data)
3. **FireSTARR binary** - Download or use existing
4. **Configuration** - Paths, ports, and environment setup

The installer validates all prerequisites and offers to fix common issues automatically.

### Quick Start (Container)

After running the installer:

```bash
docker compose up -d
```

Access the application at <http://localhost:3901>

### Quick Start (Metal)

After running the installer:

```bash
npm start
```

Access the application at <http://localhost:4901>

## Development

```bash
npm install
npm run dev            # Watch mode (frontend + backend)
npm test               # Run tests
npm run lint           # ESLint
```

## Contributing

Contributions welcome. See open issues or contact the maintainers.

## License

AGPLv3 - See [LICENSE](LICENSE) for details.

---

*Project Nomad - Making fire modeling accessible to those who need it most.*
