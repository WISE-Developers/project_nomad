# Project Nomad - Quick Start Guide (SAN Mode)

This guide walks you through the interactive installer for a Stand Alone Nomad (SAN) deployment.

## Prerequisites

- **Git** - to clone the repository
- **Docker & Docker Compose** (for Docker mode) or **Node.js >= 20** (for Metal mode)
- **~55GB disk space** - for the FireSTARR national dataset

## Step 1: Clone and Run Installer

```bash
git clone https://github.com/WISE-Developers/project_nomad.git
cd project_nomad
./scripts/install_nomad_setup.sh
```

You'll see the welcome screen:

```
════════════════════════════════════════════════════════════
         Project Nomad Setup Wizard v2.0.0
════════════════════════════════════════════════════════════
```

## Step 2: Deployment Mode

```
════════════════════════════════════════════════════════════
              Step 1: Deployment Mode
════════════════════════════════════════════════════════════

    1) SAN (Stand Alone Nomad)
       Complete self-contained deployment
       - SQLite database (no external DB required)
       - Simple username-based authentication
       - Ideal for: single users, demonstrations, field deployments

Select an option [1-2] (default: 1):
```

**Choose 1** for SAN.

## Step 3: Infrastructure

```
════════════════════════════════════════════════════════════
              Step 2: Infrastructure
════════════════════════════════════════════════════════════

    1) Docker (Recommended)
       Everything runs in containers
       - Easiest setup, consistent across platforms
       - Requires: Docker Desktop or Docker Engine

    2) Metal
       Everything runs natively on host
       - Maximum performance, no containerization overhead
       - Requires: Node.js >= 20, GDAL libraries, FireSTARR binary

Select an option [1-2] (default: 1):
```

**Choose 1 (Docker)** for easiest setup, or **2 (Metal)** for bare metal.

If you choose Metal on Linux, the installer validates system libraries and PROJ database schema, offering to fix issues automatically.

## Step 4: FireSTARR Dataset

```
FireSTARR Dataset
    The dataset includes fuel grids, DEM data (~50GB).

    1) Use existing dataset
       Point to an already-installed FireSTARR dataset

    2) Download dataset
       Download the dataset during installation

    3) Skip for now
       Configure dataset location later

Select an option [1-3] (default: 2):
```

**Choose 2** to download the national dataset (~50GB), or **1** if you already have it.

If downloading, you'll be prompted for:
- **Download folder** - where to save the archive (default: `~/Downloads`)
- **Install path** - where to extract the dataset (default: `~/firestarr_data`)

## Step 5: FireSTARR Binary (Metal mode only)

If you chose Metal mode:

```
FireSTARR Binary
    The FireSTARR fire modeling engine.

    1) Use existing installation
       Point to an already-installed FireSTARR binary

    2) Download binary
       Download the appropriate binary for your system

Select an option [1-2] (default: 2):
```

**Choose 2** to download, or **1** to point to an existing binary.

## Step 6: Configuration Summary

The installer shows your configuration and asks for confirmation:

```
════════════════════════════════════════════════════════════
              Configuration Summary
════════════════════════════════════════════════════════════

    Deployment Mode:     SAN
    Infrastructure:      Docker
    Dataset Path:        /home/user/firestarr_data
    ...

Proceed with installation? [Y/n]:
```

Press **Enter** or **Y** to proceed.

## Step 7: Installation

The installer:
1. Downloads the FireSTARR dataset (if selected)
2. Downloads the FireSTARR binary (Metal mode)
3. Generates the `.env` configuration file
4. Builds the application (Metal mode) or prepares Docker config

## Step 8: Start the Application

After installation completes:

### Docker Mode

```bash
docker compose up -d
```

Access Nomad at **http://localhost:8080**

### Metal Mode

```bash
npm start
```

Access Nomad at **http://localhost:4901**

## Verify It's Working

```bash
# Health check
curl http://localhost:4901/api/health

# Docker: check containers
docker compose ps
```

## Troubleshooting

### PROJ schema version error (Linux Metal)

The installer detects this and offers to fix it. If you see:

```
✖ PROJ database schema version too old
    Found: proj.db schema version 2
    Required: schema version >= 6
```

Answer **Y** when prompted to install updated PROJ data.

### Dataset download fails

- Check your internet connection
- Try downloading manually from the URL shown
- Use option 1 (existing dataset) and point to the downloaded location

### Permission denied

```bash
chmod +x ./scripts/install_nomad_setup.sh
```

---

For more details, see [README.md](README.md).
