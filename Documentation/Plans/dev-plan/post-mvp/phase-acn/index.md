# Phase 3: ACN Preparation

**Status**: NEXT (Active Development)
**GitHub Milestones**: P3-001 through P3-007
**SST Reference**: [R3-nomad-frontend.md](../../../persist/SMEKB/Nomad/plan/SST/SAN/R3-nomad-frontend.md)

## Overview

Phase 3 prepares Project Nomad for Agency-Centric deployment mode (ACN). This enables agencies to embed the Nomad frontend as a React component within their existing systems, using their own authentication providers and data services.

**Key Architectural Changes:**
- Core Abstraction layer driven by `NOMAD_DEPLOYMENT_MODE` environment variable
- Configuration Service with living schema
- Auth Abstraction supporting OIDC/OAuth 2.0 and SAML 2.0 protocols
- Frontend packaged as embeddable React component
- PostgreSQL/PostGIS for multi-user deployments
- API versioning for stability guarantees

## Milestones

| ID | Name | Tasks | Focus |
|----|------|-------|-------|
| P3-001 | [Core Abstraction Layer](./P3-001-core-abstraction.md) | 4 | Deployment mode detection, mode-aware services |
| P3-002 | [Configuration Service](./P3-002-config-service.md) | 5 | Living schema, loader, agency config |
| P3-003 | [Auth Abstraction](./P3-003-auth-abstraction.md) | 5 | OIDC/OAuth 2.0, SAML 2.0, abstraction layer |
| P3-004 | [Embeddable React Component](./P3-004-embeddable-component.md) | 4 | Component packaging, embed API |
| P3-005 | [Agency Data Services](./P3-005-agency-data-services.md) | 4 | Agency WFS/WCS integration |
| P3-006 | [PostgreSQL/PostGIS](./P3-006-postgis-repositories.md) | 1 | Agency integration docs (DESCOPED - agency owns DB) |
| P3-007 | [API Versioning](./P3-007-api-versioning.md) | 3 | Version strategy, stability guarantees |

**Total Tasks**: 26

## Dependency Graph

```
P3-001: Core Abstraction ──────────────────────────┐
    │                                               │
    ▼                                               │
P3-002: Configuration Service                       │
    │                                               │
    ├──────────────────┬────────────────┐          │
    ▼                  ▼                ▼          │
P3-003: Auth      P3-005: Agency    P3-006: PostGIS
    │              Data Services         │
    │                  │                 │
    └──────────────────┼─────────────────┘
                       │
                       ▼
              P3-004: Embeddable Component
                       │
                       ▼
              P3-007: API Versioning
```

## Implementation Order

### Sprint 1: Foundation (P3-001 + P3-002)
1. **P3-001-01**: Deployment mode detection
2. **P3-001-02**: Mode context provider
3. **P3-002-01**: Configuration schema v2
4. **P3-002-02**: Configuration loader refactor
5. **P3-001-03**: Mode-aware service factory
6. **P3-001-04**: Integration tests

### Sprint 2: Authentication (P3-003)
7. **P3-003-01**: Auth provider interface
8. **P3-003-02**: OIDC/OAuth 2.0 implementation
9. **P3-003-03**: SAML 2.0 implementation
10. **P3-003-04**: Role mapping service
11. **P3-003-05**: Auth integration tests

### Sprint 3: Data Layer (P3-005 + P3-006)
12. **P3-005-01**: Agency data service interface
13. **P3-005-02**: WFS client implementation
14. **P3-005-03**: WCS client implementation
15. **P3-005-04**: Agency data integration tests
16. **P3-006-01**: Agency integration guide (documentation only - agency owns DB)

### Sprint 4: Integration (P3-004 + P3-007)
17. **P3-004-01**: Component entry point
18. **P3-004-02**: Embed configuration API
19. **P3-004-03**: Build toolchain for library mode
20. **P3-004-04**: Component documentation
21. **P3-007-01**: API version header middleware
22. **P3-007-02**: Versioned route structure
23. **P3-007-03**: Deprecation warning system

## Success Criteria

- [ ] Nomad can run in either SAN or ACN mode via `NOMAD_DEPLOYMENT_MODE`
- [ ] ACN mode authenticates via agency OIDC or SAML provider
- [ ] Agency can embed Nomad frontend in their React application
- [ ] ACN mode uses agency-provided repository adapters (agency owns database)
- [ ] API has version prefix and stability guarantees
- [ ] All existing SAN functionality continues to work

## Notes

- Phase 2 (WISE) is ON HOLD - do not work on WISE integration
- This phase supersedes and incorporates relevant parts of phase-11-auth and phase-12-spatial-db
- SST (R3-nomad-frontend.md) is authoritative - implementation must conform to it
