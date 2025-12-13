# P3-007: API Versioning

**GitHub Milestone**: [P3-007: API Versioning](https://github.com/WISE-Developers/project_nomad/milestone/15)

## Overview

Implement API versioning to provide stability guarantees for agencies integrating with Nomad. Once an agency deploys against a specific API version, their integration should continue working until they explicitly upgrade.

## Tasks

### P3-007-01: API Version Header Middleware

**Description**: Create middleware that handles API version detection and routing.

**Acceptance Criteria**:
- [ ] Create `ApiVersionMiddleware` that reads version from URL or header
- [ ] Support URL versioning: `/api/v1/models`, `/api/v2/models`
- [ ] Support header versioning: `X-API-Version: 1` (fallback)
- [ ] Default to latest stable version when not specified
- [ ] Add `X-API-Version` response header with resolved version
- [ ] Log version usage for analytics

**Files to Create/Modify**:
- `backend/src/infrastructure/api/middleware/ApiVersionMiddleware.ts`
- `backend/src/infrastructure/api/middleware/index.ts`

**Dependencies**: P3-001-01

---

### P3-007-02: Versioned Route Structure

**Description**: Restructure API routes to support multiple versions.

**Acceptance Criteria**:
- [ ] Create route structure: `/api/v1/...`, `/api/v2/...`
- [ ] V1 routes: current API (frozen after release)
- [ ] V2 routes: development version (may change)
- [ ] Shared logic in versioned handlers (avoid duplication where possible)
- [ ] Version-specific request/response transformers
- [ ] Health endpoint remains unversioned (`/api/health`)

**Files to Create/Modify**:
- `backend/src/infrastructure/api/routes/v1/index.ts`
- `backend/src/infrastructure/api/routes/v1/models.ts`
- `backend/src/infrastructure/api/routes/v1/jobs.ts`
- `backend/src/infrastructure/api/routes/v2/index.ts`
- `backend/src/infrastructure/api/app.ts` (mount versioned routes)

**Dependencies**: P3-007-01

---

### P3-007-03: Deprecation Warning System

**Description**: Implement deprecation warnings for old API versions.

**Acceptance Criteria**:
- [ ] Add `Deprecation` header when using deprecated version
- [ ] Add `Sunset` header with removal date for deprecated versions
- [ ] Log deprecation warnings for monitoring
- [ ] Create deprecation policy documentation
- [ ] Add `/api/versions` endpoint listing all versions and their status
- [ ] Status types: `current`, `supported`, `deprecated`, `sunset`

**Files to Create/Modify**:
- `backend/src/infrastructure/api/middleware/DeprecationMiddleware.ts`
- `backend/src/infrastructure/api/routes/versions.ts`
- `backend/docs/API_VERSIONING.md`

**Dependencies**: P3-007-01, P3-007-02

---

## Architecture Notes

### Version Lifecycle

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Development│ ──▶ │   Current   │ ──▶ │ Deprecated  │ ──▶ │   Sunset    │
│   (v2-dev)  │     │    (v1)     │     │   (v0)      │     │  (removed)  │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
     │                   │                   │
     │                   │                   │
     ▼                   ▼                   ▼
  No guarantees     12 months            6 months
  Breaking changes  support              warning
  allowed           guaranteed           period
```

### URL Structure

```
/api/health              # Unversioned (always latest)
/api/versions            # List all versions

/api/v1/models           # V1 - Stable
/api/v1/models/:id
/api/v1/jobs
/api/v1/jobs/:id

/api/v2/models           # V2 - Development (may change)
/api/v2/models/:id
```

### Response Headers

```http
HTTP/1.1 200 OK
X-API-Version: 1
Content-Type: application/json

# For deprecated version:
HTTP/1.1 200 OK
X-API-Version: 0
Deprecation: true
Sunset: Sat, 1 Jan 2026 00:00:00 GMT
Content-Type: application/json
```

### Versions Endpoint Response

```json
{
  "versions": [
    {
      "version": 2,
      "status": "development",
      "description": "Development version - breaking changes possible"
    },
    {
      "version": 1,
      "status": "current",
      "description": "Current stable version",
      "supportedUntil": "2026-12-01"
    },
    {
      "version": 0,
      "status": "deprecated",
      "description": "Legacy version - will be removed",
      "sunset": "2025-06-01"
    }
  ],
  "default": 1
}
```

## Versioning Policy

Document in `API_VERSIONING.md`:

1. **Current Version**: Fully supported, no breaking changes
2. **Deprecated Version**: Still functional, deprecation headers sent, 6-month notice before removal
3. **Breaking Changes**: Only in new major version, never in current
4. **Support Window**: Each version supported for minimum 12 months after next version releases
5. **Non-Breaking Changes**: May be added to current version (new fields, new endpoints)

## SST Alignment

From master plan:
> **Backend:**
> - [ ] API versioning and stability guarantees

Agencies need confidence that their integrations won't break unexpectedly. Versioning provides that contract.
