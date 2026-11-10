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
| Ubuntu 22.04+ | Supported | see the host library floors below |
| macOS 14+ | Supported | Homebrew for dependencies |
| Windows 10/11 | Supported | Manual dependency installation |

#### Host library floors (bare metal / Metal mode only)

These are set by the prebuilt `gdal-async` native addon that a Metal install compiles
against, and they differ by architecture. **Both** must be satisfied — a host that clears
the glibc floor but not the libstdc++ one installs cleanly and then fails when the backend
loads the addon.

| Architecture | glibc | libstdc++ |
|---|---|---|
| x86_64 | >= 2.29 | exports `GLIBCXX_3.4.26` |
| aarch64 / arm64 | >= 2.35 | exports `GLIBCXX_3.4.30` |

Ubuntu 22.04 (glibc 2.35, `GLIBCXX_3.4.30`) satisfies both on either architecture, which is
why it is the recommended minimum. Ubuntu 20.04 (glibc 2.31, `GLIBCXX_3.4.28`) also meets
the x86_64 floors, but is past its standard support window and is not recommended.

**FireSTARR itself imposes no host library requirement.** The published release binary is
statically linked, so it does not constrain the floors above. Docker deployments are not
affected by any of this: the addon is loaded inside the container against the image's own
libraries, so the host's versions do not apply.

## Network Requirements

| Service | Purpose | Required |
|---------|---------|----------|
| MapLibre GL | Map rendering | No (open source, self-hosted) |
| CartoDB | Basemap tiles | No (free, no API key required) |
| SpotWX API | Weather forecast data | Yes (paid subscription) |

Maps use MapLibre GL with CartoDB basemaps (no API key required). A [SpotWX API](https://spotwx.com/api/) subscription is required for weather data (paid).

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
