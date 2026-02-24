# Nomad Minimum System Requirements

Minimum requirements for deploying the Nomad web application.

For fire modeling engine requirements, see [FireSTARR Requirements](FIRESTARR_REQUIREMENTS.md).

## Hardware

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 2 cores | 4+ cores |
| RAM | 4 GB | 8 GB+ |
| Disk | 2 GB | 5 GB+ |

Disk covers the application, Node modules, container images (container mode), and SQLite database.

## Software Prerequisites

### Container Mode (Recommended)

| Dependency | Minimum Version | Notes |
|------------|----------------|-------|
| Docker API | - | Any runtime providing Docker-compatible API (Docker, Colima, Podman, etc.) |
| Docker Compose | v2 | |
| Git | any | |

Container mode is the simplest path. The installer handles everything else.

### Bare Metal Mode

| Dependency | Minimum Version | Notes |
|------------|----------------|-------|
| Node.js | 20.0.0 | LTS recommended |
| npm | included with Node.js | |
| GDAL | 3.0+ | Native library required by `gdal-async` |
| SQLite | 3.x | |
| Python 3 | 3.x | GDAL build support |
| Build tools | - | gcc/g++/make (Linux), Xcode CLI Tools (macOS), Visual C++ (Windows) |

### GDAL Installation by Platform

| Platform | Command |
|----------|---------|
| Ubuntu/Debian | `sudo apt install libgdal-dev gdal-bin` |
| macOS (Homebrew) | `brew install gdal` |
| Windows | Install via [OSGeo4W](https://trac.osgeo.org/osgeo4w/) |

## Platform Support

### Container Deployments

| Platform | Status |
|----------|--------|
| Linux x86_64 | Supported |
| Linux ARM64 | Supported |
| macOS Intel | Supported |
| macOS Apple Silicon | Supported |
| Windows x86_64 | Supported |

### Bare Metal Deployments

| Platform | Status | Notes |
|----------|--------|-------|
| Ubuntu 22.04+ | Supported | glibc >= 2.34 required |
| macOS 14+ | Supported | Homebrew for dependencies |
| Windows 10/11 | Supported | Manual dependency installation |

## Network Requirements

| Service | Purpose | Required |
|---------|---------|----------|
| MapBox API | Map tiles and rendering | Yes (free token) |
| SpotWX API | Weather forecast data | Yes (paid subscription) |

A [MapBox](https://account.mapbox.com/access-tokens/) access token is required (free). A [SpotWX API](https://spotwx.com/api/) subscription is required for weather data (paid).

## Ports

| Mode | Frontend | Backend |
|------|----------|---------|
| Container | 3901 | 4901 |
| Bare Metal | - | 4901 (unified) |

All ports are configurable via environment variables.

## Environment Variables

See `.env.example` in the project root for the full list. Nomad-specific variables:

| Variable | Description | Required |
|----------|-------------|----------|
| `VITE_MAPBOX_TOKEN` | MapBox API access token | Yes |
| `NOMAD_DEPLOYMENT_MODE` | `SAN` (default) or `ACN` | No |
| `PORT` | Backend port (bare metal) | No |

## Installation

The interactive installer validates all prerequisites and guides setup:

```bash
git clone https://github.com/WISE-Developers/project_nomad.git
cd project_nomad
./install.sh
```

## See Also

- [FireSTARR Requirements](FIRESTARR_REQUIREMENTS.md) - Fire modeling engine requirements
- [README](README.md) - Project overview and quick start
