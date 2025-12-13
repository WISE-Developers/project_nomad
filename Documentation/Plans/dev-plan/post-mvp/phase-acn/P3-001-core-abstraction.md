# P3-001: Core Abstraction Layer

**GitHub Milestone**: [P3-001: Core Abstraction Layer](https://github.com/WISE-Developers/project_nomad/milestone/9)

## Overview

Create the deployment mode abstraction layer that enables the same Nomad codebase to run in SAN (Stand Alone Nomad) or ACN (Agency Centric Nomad) modes. The deployment mode is determined by the `NOMAD_DEPLOYMENT_MODE` environment variable.

## Tasks

### P3-001-01: Deployment Mode Detection

**Description**: Create the core deployment mode detection and type system.

**Acceptance Criteria**:
- [ ] Define `DeploymentMode` type: `'SAN' | 'ACN'`
- [ ] Create `getDeploymentMode()` function reading from `NOMAD_DEPLOYMENT_MODE` env var
- [ ] Default to `'SAN'` when env var not set
- [ ] Validate env var value (throw on invalid)
- [ ] Add deployment mode to backend health endpoint response

**Files to Create/Modify**:
- `backend/src/core/deployment/DeploymentMode.ts`
- `backend/src/core/deployment/index.ts`
- `backend/src/infrastructure/api/routes/health.ts` (modify)

**Dependencies**: None

---

### P3-001-02: Mode Context Provider (Frontend)

**Description**: Create React context for deployment mode awareness in frontend.

**Acceptance Criteria**:
- [ ] Create `DeploymentModeContext` with current mode
- [ ] Create `DeploymentModeProvider` that fetches mode from backend health endpoint
- [ ] Create `useDeploymentMode()` hook
- [ ] Create `isSAN()` and `isACN()` helper hooks
- [ ] Provider initializes on app startup

**Files to Create/Modify**:
- `frontend/src/core/deployment/DeploymentModeContext.tsx`
- `frontend/src/core/deployment/useDeploymentMode.ts`
- `frontend/src/core/deployment/index.ts`
- `frontend/src/App.tsx` (wrap with provider)

**Dependencies**: P3-001-01

---

### P3-001-03: Mode-Aware Service Factory

**Description**: Create factory pattern for instantiating mode-appropriate service implementations.

**Acceptance Criteria**:
- [ ] Create `ServiceFactory` class with mode-based service resolution
- [ ] Factory returns SAN or ACN implementation based on deployment mode
- [ ] Services to abstract: Auth, Configuration, ModelRepository, SpatialRepository
- [ ] Implement lazy initialization (services created on first use)
- [ ] Add service factory to backend dependency injection

**Files to Create/Modify**:
- `backend/src/core/deployment/ServiceFactory.ts`
- `backend/src/core/deployment/ServiceRegistry.ts`
- `backend/src/infrastructure/di/container.ts` (modify)

**Dependencies**: P3-001-01

---

### P3-001-04: Core Abstraction Integration Tests

**Description**: Test suite verifying deployment mode behavior.

**Acceptance Criteria**:
- [ ] Test: SAN mode is default when env var not set
- [ ] Test: ACN mode activates when `NOMAD_DEPLOYMENT_MODE=ACN`
- [ ] Test: Invalid mode value throws descriptive error
- [ ] Test: Service factory returns correct implementations per mode
- [ ] Test: Frontend context reflects backend mode

**Files to Create/Modify**:
- `backend/src/core/deployment/__tests__/DeploymentMode.test.ts`
- `backend/src/core/deployment/__tests__/ServiceFactory.test.ts`
- `frontend/src/core/deployment/__tests__/DeploymentModeContext.test.tsx`

**Dependencies**: P3-001-01, P3-001-02, P3-001-03

---

## Architecture Notes

```
┌─────────────────────────────────────────────────────────┐
│                    App Startup                          │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│              getDeploymentMode()                        │
│         reads NOMAD_DEPLOYMENT_MODE env var             │
└─────────────────────┬───────────────────────────────────┘
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
    ┌───────────┐           ┌───────────┐
    │    SAN    │           │    ACN    │
    └─────┬─────┘           └─────┬─────┘
          │                       │
          ▼                       ▼
    ┌───────────┐           ┌───────────┐
    │ SQLite    │           │ PostgreSQL│
    │ File Auth │           │ OIDC/SAML │
    │ Local Cfg │           │ Agency Cfg│
    └───────────┘           └───────────┘
```

## SST Alignment

From R3-nomad-frontend.md:
> **Core Abstraction (Phase 3)**: Deployment Mode drives Configuration and Auth - same frontend serves SAN and ACN

The Core Abstraction is the single switch that changes all downstream service behavior.
