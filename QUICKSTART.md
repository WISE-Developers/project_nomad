# Project Nomad - Quick Start Guide

Get Project Nomad running on a fresh server in 5 minutes.

## Prerequisites

- Docker & Docker Compose
- Git
- `curl` and `unzip` (for dataset installer)
- ~5GB free disk space (3GB dataset + containers)

## Deployment Steps

### 1. Clone the Repository

```bash
git clone git@github.com:WISE-Developers/project_nomad.git
cd project_nomad
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Check your user ID matches the default (1000):
```bash
id
```

If your `uid` is not 1000, edit `.env` and update `USER_ID` to match.

### 3. Install FireSTARR Dataset

This downloads the ~3GB national dataset (fuel grids, DEM, boundaries):

```bash
bash ./scripts/install-firestarr-dataset.sh
```

The script will:
- Download from the configured URL
- Extract to `./firestarr_data/`
- Clean up the temporary zip file
- Verify the installation

### 4. Build Containers

```bash
docker compose build
```

### 5. Start Services

```bash
docker compose up -d
```

### 6. Verify

Check services are running:
```bash
docker compose ps
```

Access the application:
- **Frontend**: http://localhost:8080
- **Backend API**: http://localhost:3001/api
- **Health Check**: http://localhost:3001/api/health

## Local Development

For development with hot reload (requires Node.js):

```bash
npm install
npm run dev
```

- Frontend (Vite HMR): http://localhost:5173
- Backend (tsx watch): http://localhost:3001

## Troubleshooting

### Dataset download fails
- Check `FIRESTARR_DATASET_SOURCE` URL in `.env`
- Verify network connectivity to the distribution server
- Try downloading manually and setting source to local path

### Permission errors in containers
- Ensure `USER_ID` in `.env` matches your host user (`id -u`)
- Check `./firestarr_data` directory permissions

### Containers won't start
```bash
docker compose logs
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `VERSION` | FireSTARR container version | `0.9.5.4` |
| `USERNAME` | Container user name | `user` |
| `USER_ID` | Container user ID (match host) | `1000` |
| `FIRESTARR_DATASET_SOURCE` | Dataset URL or local path | See `.env.example` |
| `FIRESTARR_DATASET_PATH` | Dataset installation directory | `./firestarr_data` |
