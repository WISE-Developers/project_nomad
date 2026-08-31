# Deterministic Installers

Project Nomad provides **deterministic installers** that allow quick installation without git clone or interactive prompts. These scripts use pre-configured defaults suitable for SAN (Stand Alone Nomad) deployments.

## Overview

Unlike the interactive `./install.sh` wizard, deterministic installers:
- Require no git clone
- Use pre-configured defaults (no prompts)
- Support environment variable overrides
- Download Nomad directly from GitHub releases

## Available Installers

| Script | Platform | Infrastructure | File |
|--------|----------|----------------|------|
| SAN + Docker | Linux/macOS | Docker | `scripts/install-nomad-san-docker.sh` |
| SAN + Metal | Linux/macOS | Native | `scripts/install-nomad-san-metal.sh` |
| SAN + Docker | Windows | Docker | `scripts/install-nomad-san-docker.ps1` |

## Prerequisites

All installers require:
- **Docker installers**: Docker Desktop or Docker Engine
- **Metal installers**: Node.js >= 20, GDAL libraries

Note: No API token required for maps - uses open-source MapLibre GL with CartoDB basemaps.

## Quick Start

### Linux/macOS - Docker (Recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/WISE-Developers/project_nomad/main/scripts/install-nomad-san-docker.sh | bash
```

Access Nomad at: `http://localhost:3901`

### Linux/macOS - Metal

```bash
curl -fsSL https://raw.githubusercontent.com/WISE-Developers/project_nomad/main/scripts/install-nomad-san-metal.sh | bash
```

Access Nomad at: `http://localhost:4901`

### Windows - Docker (PowerShell)

```powershell
iwr -useb https://raw.githubusercontent.com/WISE-Developers/project_nomad/main/scripts/install-nomad-san-docker.ps1 | iex
```

Access Nomad at: `http://localhost:3901`

## Configuration

Configure via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `INSTALL_DIR` | `./project_nomad` | Where to extract Nomad |
| `FIRESTARR_DATASET_PATH` | `~/firestarr_data` | Dataset location |
| `NOMAD_PORT` | `4901` | Server port (Metal only) |
| `NOMAD_SERVER_HOSTNAME` | `localhost` | Server hostname |
| `AUTO_INSTALL_DATASET` | (unset) | Set to `1` to auto-download dataset |
| `SKIP_START` | (unset) | Set to `1` to skip starting services |

### Examples

```bash
# Custom install directory
curl ... | INSTALL_DIR=/opt/nomad bash

# Custom dataset path
curl ... | FIRESTARR_DATASET_PATH=/data/firestarr bash

# Auto-download dataset (~3GB, one fuel year by default)
curl ... | AUTO_INSTALL_DATASET=1 bash

# Install without starting
curl ... | SKIP_START=1 bash
```

## Post-Install

### Docker Installations

```bash
cd project_nomad

# View logs
docker compose logs -f

# Stop
docker compose down

# Start again
docker compose up -d
```

### Metal Installations

```bash
cd project_nomad

# Production mode
npm run start

# Development mode
npm run dev
```

## Architecture

Deterministic installers perform these steps:

1. **Prerequisites Check** - Verify Docker/Node.js/GDAL availability
2. **Download** - Fetch Nomad release tarball from GitHub
3. **Extract** - Unpack to `INSTALL_DIR`
4. **Configure** - Generate `.env` with SAN defaults
5. **Dataset** - Check for FireSTARR dataset (optional auto-download)
6. **FireSTARR** - Install binary (Metal only)
7. **Build** - Install npm dependencies and build (Metal) or pull/build Docker images
8. **Start** - Launch Nomad (unless `SKIP_START=1`)

## Security

### Inspect Before Running

Download and review the script first:

```bash
# Download
curl -fsSL https://.../install-nomad-san-docker.sh -o install.sh

# Review
cat install.sh

# Run
bash install.sh
```

### What the Scripts Do

- Download Nomad from official GitHub releases
- Create files in specified `INSTALL_DIR` (default: `./project_nomad`)
- Generate `.env` configuration file
- For Docker: build/pull images, create containers
- For Metal: install npm packages, build application
- **Never** modify system directories outside `INSTALL_DIR`

## Troubleshooting

### "Docker not available"

Install Docker Desktop:
- **macOS**: `brew install --cask docker`
- **Linux**: Follow [Docker docs](https://docs.docker.com/engine/install/)
- **Windows**: Download from [Docker Hub](https://docs.docker.com/desktop/install/windows/)

### "Node.js version too old" (Metal)

Install Node.js >= 20:
- **macOS**: `brew install node@20`
- **Linux**: Use [NodeSource](https://github.com/nodesource/distributions)
- **Windows**: Download from [nodejs.org](https://nodejs.org/)

### "GDAL not found" (Metal)

```bash
# Ubuntu/Debian
sudo apt-get install gdal-bin libgdal-dev

# macOS
brew install gdal
```

### FireSTARR Dataset Missing

If dataset not found, the installer will:
1. Warn and continue (if `AUTO_INSTALL_DATASET` not set)
2. Download automatically (if `AUTO_INSTALL_DATASET=1`)

Install later:
```bash
cd project_nomad
./scripts/install-firestarr-dataset.sh
```

## Comparison: Deterministic vs Interactive

| Feature | Deterministic | Interactive (`./install.sh`) |
|---------|---------------|------------------------------|
| Git clone | ❌ Not needed | ✅ Required |
| Prompts | ❌ None | ✅ Full wizard |
| Deployment modes | SAN only | SAN, ACN |
| Database | SQLite | SQLite, PostgreSQL, MySQL, etc. |
| Auth | Simple | Simple, OAuth, OIDC |
| Customization | Env vars | Interactive menus |
| Use case | Quick start, CI/CD | Production, agencies |

## See Also

- [QUICKSTART.md](../../QUICKSTART.md) - Quick reference guide
- [README.md](../../README.md) - Full documentation
- `scripts/install_nomad_setup.sh` - Interactive installer source

## License

AGPL-3.0. See [LICENSE](../../LICENSE) for details.
