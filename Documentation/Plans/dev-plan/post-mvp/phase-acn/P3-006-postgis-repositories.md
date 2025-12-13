# P3-006: PostgreSQL/PostGIS Repositories

**GitHub Milestone**: [P3-006: PostgreSQL/PostGIS Repositories](https://github.com/WISE-Developers/project_nomad/milestone/14)

## Overview

Implement PostgreSQL/PostGIS-backed repositories for ACN deployments. While SAN mode uses SQLite/SpatiaLite for single-user local deployments, ACN mode requires PostgreSQL/PostGIS for multi-user, enterprise-grade persistence with proper connection pooling and spatial indexing.

## Tasks

### P3-006-01: PostgreSQL Connection Manager

**Description**: Create connection manager for PostgreSQL with pooling and configuration.

**Acceptance Criteria**:
- [ ] Create `PostgreSQLConnectionManager` class
- [ ] Support connection pooling (configurable pool size)
- [ ] Read connection params from configuration or env vars
- [ ] Support SSL connections (required for production)
- [ ] Implement health check method
- [ ] Handle connection failures gracefully (retry, circuit breaker)
- [ ] Clean shutdown (drain pool)

**Files to Create/Modify**:
- `backend/src/infrastructure/persistence/PostgreSQLConnectionManager.ts`
- `backend/src/infrastructure/persistence/PostgreSQLConfig.ts`

**Dependencies**: P3-001-03, P3-002-02

**External Dependencies**:
- `pg` (node-postgres)
- `pg-pool`

---

### P3-006-02: PostGIS Model Repository

**Description**: Implement model repository using PostgreSQL.

**Acceptance Criteria**:
- [ ] Create `PostgreSQLModelRepository` implementing `IModelRepository`
- [ ] Store models with all fields (JSON columns for complex data)
- [ ] Support queries: by ID, by user, by status, by date range
- [ ] Implement pagination for list queries
- [ ] Add database indexes for common queries
- [ ] Store model spatial extent as PostGIS geometry

**Files to Create/Modify**:
- `backend/src/infrastructure/persistence/PostgreSQLModelRepository.ts`
- `backend/src/infrastructure/persistence/migrations/001_create_models_table.sql`

**Dependencies**: P3-006-01

---

### P3-006-03: PostGIS Spatial Repository

**Description**: Implement spatial repository using PostGIS for geometry storage and spatial queries.

**Acceptance Criteria**:
- [ ] Create `PostGISSpatialRepository` implementing `ISpatialRepository`
- [ ] Store geometries with spatial index (GIST)
- [ ] Implement spatial queries: within bbox, intersects, contains
- [ ] Support multiple geometry types (point, line, polygon, multipolygon)
- [ ] Handle coordinate reference system transformations
- [ ] Store and query by model ID relationship

**Files to Create/Modify**:
- `backend/src/infrastructure/persistence/PostGISSpatialRepository.ts`
- `backend/src/infrastructure/persistence/migrations/002_create_spatial_tables.sql`

**Dependencies**: P3-006-01

---

### P3-006-04: Database Migration System

**Description**: Create migration system for managing PostgreSQL schema changes.

**Acceptance Criteria**:
- [ ] Create migration runner that executes SQL files in order
- [ ] Track applied migrations in `_migrations` table
- [ ] Support rollback (down migrations)
- [ ] Migration files: `{version}_{name}_up.sql`, `{version}_{name}_down.sql`
- [ ] CLI command: `npm run db:migrate`
- [ ] CLI command: `npm run db:rollback`
- [ ] Verify migrations are idempotent

**Files to Create/Modify**:
- `backend/src/infrastructure/persistence/MigrationRunner.ts`
- `backend/src/infrastructure/persistence/migrations/000_create_migrations_table.sql`
- `backend/package.json` (add migration scripts)
- `backend/scripts/db-migrate.ts`
- `backend/scripts/db-rollback.ts`

**Dependencies**: P3-006-01

---

## Architecture Notes

### Repository Pattern

```
┌─────────────────────────────────────────────────────────┐
│                    Use Cases                            │
│            (Clean Architecture)                         │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────┴─────────────────────────────────┐
│                 Repository Interfaces                    │
│   IModelRepository, ISpatialRepository, IJobRepository  │
└───────────────────────┬─────────────────────────────────┘
                        │
          ┌─────────────┴─────────────┐
          │                           │
          ▼                           ▼
┌─────────────────────┐   ┌─────────────────────┐
│   SAN Mode          │   │   ACN Mode          │
│   SQLite/SpatiaLite │   │   PostgreSQL/PostGIS│
└─────────────────────┘   └─────────────────────┘
```

### Database Schema (ACN)

```sql
-- Models table
CREATE TABLE models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    engine VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL,
    config JSONB NOT NULL,
    results JSONB,
    extent GEOMETRY(POLYGON, 4326),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_models_status ON models(status);
CREATE INDEX idx_models_created_by ON models(created_by);
CREATE INDEX idx_models_extent ON models USING GIST(extent);

-- Spatial data table
CREATE TABLE model_geometries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id UUID REFERENCES models(id) ON DELETE CASCADE,
    geometry_type VARCHAR(50) NOT NULL,
    geometry GEOMETRY NOT NULL,
    properties JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_geometries_model ON model_geometries(model_id);
CREATE INDEX idx_geometries_geom ON model_geometries USING GIST(geometry);
```

### Configuration

```json
{
  "database": {
    "type": "postgresql",
    "host": "${DB_HOST}",
    "port": 5432,
    "database": "nomad",
    "user": "${DB_USER}",
    "password": "${DB_PASSWORD}",
    "ssl": true,
    "pool": {
      "min": 2,
      "max": 10
    }
  }
}
```

## Migration Example

```sql
-- migrations/001_create_models_table_up.sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE models (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- ... columns
);

-- migrations/001_create_models_table_down.sql
DROP TABLE IF EXISTS models;
```

## SST Alignment

From master plan:
> **Backend:**
> - [ ] PostgreSQL/PostGIS repository implementations

ACN deployments need enterprise-grade persistence that supports multiple concurrent users and proper spatial indexing.
