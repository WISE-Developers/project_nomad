# Project Nomad Architecture

## Deployment Overview

Project Nomad is a SAN-first (Stand Alone Nomad) application. The primary deployment mode is self-hosted via Docker Compose on a single host. An ACN (Agency Centric Nomad) mode exists for integration into existing agency infrastructure.

- **SAN**: Self-contained Docker Compose stack. SQLite database, simple username auth, all services on one host.
- **ACN**: Component integrated into agency systems. Uses PostGIS (via Knex), auth deferred to the host application.

---

## Service Architecture

The Docker Compose stack contains three services:

```
┌─────────────────────────────────────────────────────────┐
│                  Docker Compose Host                    │
│                                                         │
│  ┌─────────────────────┐   ┌─────────────────────────┐  │
│  │   nomad-frontend    │   │    nomad-backend        │  │
│  │   (Nginx, port 80)  │   │   (Express, port 3001)  │  │
│  │   Host: 3901        │──▶│   Host: 4901            │  │
│  └─────────────────────┘   └───────────┬─────────────┘  │
│                                        │                │
│                                        │ Docker socket  │
│                                        ▼                │
│                         ┌─────────────────────────────┐ │
│                         │   firestarr-app (template)  │ │
│                         │   Spawned per job by        │ │
│                         │   DockerExecutor            │ │
│                         │   Profile: "modeling"       │ │
│                         └─────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### nomad-backend
- **Internal port**: 3001
- **Host port**: `${NOMAD_BACKEND_HOST_PORT}` (default: 4901)
- Express 4.21 / Node.js / TypeScript
- Knex ORM with better-sqlite3 (SAN) or PostgreSQL/PostGIS (ACN)
- Winston logging, gdal-async for raster processing, cffdrs for FWI
- Mounts `/var/run/docker.sock` to spawn FireSTARR containers
- Mounts `${FIRESTARR_DATASET_PATH}` as `/appl/data`

### nomad-frontend
- **Internal port**: 80
- **Host port**: `${NOMAD_FRONTEND_HOST_PORT}` (default: 3901)
- React 18 / TypeScript / Vite build
- Served by Nginx inside the container
- MapBox GL JS for map rendering

### firestarr-app
- Template service — **not started by `docker compose up`**
- Runs under the `modeling` Docker Compose profile
- Spawned as ephemeral containers by the backend's `DockerExecutor` for each job
- Image set via `FIRESTARR_IMAGE` env var in `.env`

---

## Database Layer

**SAN mode:** SQLite via better-sqlite3, accessed through Knex. No external database service required.

**ACN mode:** PostgreSQL with PostGIS, also accessed through Knex. Connection configured via environment variables.

Knex provides a consistent query interface across both modes. Schema migrations are managed by Knex.

---

## Real-Time Updates

Job progress is streamed from backend to frontend using **Server-Sent Events (SSE)**. The frontend subscribes to a job's SSE endpoint after submission and receives status updates as the FireSTARR container runs.

Browser **Web Push notifications** are also implemented for job completion alerts when the tab is not in focus.

There is no polling. The frontend does not periodically fetch job status.

---

## Authentication

**SAN mode:** Simple auth — username entry. Controlled by the `VITE_SIMPLE_AUTH` environment variable (default: `true`).

**ACN mode:** Auth is deferred to the host agency application. No OIDC or SAML is built into Nomad.

---

## FireSTARR Execution Model

The backend's `DockerExecutor` service manages FireSTARR job execution:

1. A job is submitted via the API
2. The backend prepares the job directory under `${FIRESTARR_DATASET_PATH}/sims/{jobId}/`
3. `DockerExecutor` runs `docker compose run --rm firestarr-app <args>` via the mounted Docker socket
4. The container reads fuel/DEM grids from `/appl/data/generated/grid/100m/` and writes outputs to `/appl/data/sims/{jobId}/`
5. Status updates are pushed to connected clients via SSE
6. On completion, the backend processes output GeoTIFFs using gdal-async

A native binary execution path also exists as an alternative to Docker container spawning.

### Volume Mounts (firestarr-app)

```
/etc/ssl/certs          → /etc/ssl/certs       (SSL certificates)
${FIRESTARR_DATASET_PATH} → /appl/data         (fuel grids + sims)
${FIRESTARR_DATASET_PATH}/sims → /appl/data/sims  (simulation I/O)
```

---

## Port Configuration

All ports are driven by environment variables in `.env`:

| Variable                    | Default | Service          |
|-----------------------------|---------|------------------|
| `NOMAD_BACKEND_HOST_PORT`   | 4901    | nomad-backend    |
| `NOMAD_FRONTEND_HOST_PORT`  | 3901    | nomad-frontend   |

Internal container ports are fixed: backend at 3001, frontend at 80.

---

## File Layout (Actual)

```
project_nomad/
├── backend/
│   ├── src/
│   │   ├── index.ts
│   │   ├── routes/
│   │   ├── services/
│   │   │   ├── DockerExecutor.ts   # FireSTARR container spawning
│   │   │   ├── NativeExecutor.ts  # Native binary execution
│   │   │   └── ...
│   │   └── db/                    # Knex connection + migrations
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   └── components/
│   └── Dockerfile
├── docker-compose.yaml
└── .env                           # FIRESTARR_IMAGE, ports, paths
```

---

## Technology Stack

| Layer              | Technology                                      |
|--------------------|-------------------------------------------------|
| Frontend           | TypeScript, React 18, Vite                      |
| Map                | MapBox GL JS                                    |
| Backend            | Node.js 20+, Express 4.21, TypeScript           |
| Database (SAN)     | SQLite via better-sqlite3 + Knex                |
| Database (ACN)     | PostgreSQL + PostGIS via Knex                   |
| Spatial Processing | gdal-async, PROJ                                |
| FWI Calculation    | cffdrs (R-based, via Node binding)              |
| Real-time          | Server-Sent Events (SSE) + Web Push             |
| Fire Engine        | FireSTARR (Docker container or native binary)   |
| Deployment         | Docker Compose (single stack)                   |
| Tests              | Vitest (frontend and backend)                   |
