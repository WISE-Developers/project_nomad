# P3-002: Configuration Service

**GitHub Milestone**: [P3-002: Configuration Service](https://github.com/WISE-Developers/project_nomad/milestone/10)

## Overview

Refactor the configuration system to support both SAN and ACN deployment modes with a "living schema" that evolves as agencies onboard. Configuration drives data sources, branding, role mappings, and feature toggles.

## Tasks

### P3-002-01: Configuration Schema v2

**Description**: Define the expanded configuration schema supporting ACN requirements.

**Acceptance Criteria**:
- [ ] Add `deployment` section: mode, agency ID, environment (dev/staging/prod)
- [ ] Add `auth` section: provider type, OIDC/SAML endpoints, role mappings
- [ ] Add `dataSources` section: weather, fuel, fire points (REST/WFS/WCS)
- [ ] Add `branding` section: logo, colors, agency name
- [ ] Add `features` section: enabled features, suppressed defaults
- [ ] Create JSON Schema for validation
- [ ] Add TypeScript types matching schema

**Files to Create/Modify**:
- `backend/src/application/interfaces/IConfigurationService.ts` (extend)
- `backend/src/core/config/schema/config.schema.json` (new)
- `backend/src/core/config/types/ConfigurationTypes.ts` (new)
- `configuration/generic/config.json` (update to v2)

**Dependencies**: P3-001-01

---

### P3-002-02: Configuration Loader Refactor

**Description**: Refactor config loader to support agency-specific configurations via submodules.

**Acceptance Criteria**:
- [ ] Load config from `/configuration/{NOMAD_AGENCY_ID}/config.json` when set
- [ ] Fall back to `/configuration/generic/config.json`
- [ ] Support `suppressDefault` flag to hide default data sources
- [ ] Validate loaded config against JSON schema
- [ ] Return typed configuration object
- [ ] Cache configuration (reload on signal in dev mode)

**Files to Create/Modify**:
- `backend/src/infrastructure/config/ConfigurationLoader.ts`
- `backend/src/infrastructure/config/ConfigurationValidator.ts`
- `backend/src/infrastructure/config/index.ts`

**Dependencies**: P3-002-01

---

### P3-002-03: Agency Configuration Git Submodule Support

**Description**: Document and support agency configurations as Git submodules.

**Acceptance Criteria**:
- [ ] Create `/configuration/README.md` explaining submodule approach
- [ ] Create `/configuration/template/` with example agency config
- [ ] Document process for adding agency submodule
- [ ] Add `.gitmodules` example for agency config
- [ ] Installer script handles submodule init

**Files to Create/Modify**:
- `configuration/README.md`
- `configuration/template/config.json`
- `configuration/template/assets/logo.png` (placeholder)
- `scripts/install.sh` (modify for submodule support)

**Dependencies**: P3-002-02

---

### P3-002-04: Frontend Configuration Context

**Description**: Create React context for configuration access in frontend.

**Acceptance Criteria**:
- [ ] Create `ConfigurationContext` with typed config
- [ ] Create `ConfigurationProvider` that fetches from backend
- [ ] Create `useConfiguration()` hook
- [ ] Create `useAgencyBranding()` hook for UI customization
- [ ] Create `useDataSources()` hook for data layer
- [ ] Provider handles loading state

**Files to Create/Modify**:
- `frontend/src/core/config/ConfigurationContext.tsx`
- `frontend/src/core/config/useConfiguration.ts`
- `frontend/src/core/config/useAgencyBranding.ts`
- `frontend/src/core/config/useDataSources.ts`
- `frontend/src/core/config/index.ts`

**Dependencies**: P3-002-02, P3-001-02

---

### P3-002-05: Configuration Integration Tests

**Description**: Test suite for configuration loading and validation.

**Acceptance Criteria**:
- [ ] Test: Generic config loads when no agency ID
- [ ] Test: Agency config loads when agency ID set
- [ ] Test: Invalid config fails schema validation with useful error
- [ ] Test: suppressDefault flag works correctly
- [ ] Test: Frontend context reflects backend configuration

**Files to Create/Modify**:
- `backend/src/infrastructure/config/__tests__/ConfigurationLoader.test.ts`
- `backend/src/infrastructure/config/__tests__/ConfigurationValidator.test.ts`
- `frontend/src/core/config/__tests__/ConfigurationContext.test.tsx`

**Dependencies**: P3-002-01 through P3-002-04

---

## Configuration Schema Overview

```json
{
  "$schema": "./config.schema.json",
  "version": "2.0",
  "deployment": {
    "mode": "ACN",
    "agencyId": "nwt",
    "environment": "production"
  },
  "auth": {
    "provider": "oidc",
    "oidc": {
      "issuer": "https://auth.gov.nt.ca",
      "clientId": "nomad-client",
      "scopes": ["openid", "profile", "email"]
    },
    "roleMapping": {
      "fire-analyst": "FBAN",
      "modeler": "Modeler",
      "viewer": "User"
    }
  },
  "dataSources": {
    "weather": {
      "type": "rest",
      "endpoint": "https://spotwx.com/api/v2",
      "suppressDefault": false
    },
    "fuel": {
      "type": "wcs",
      "endpoint": "https://gis.gov.nt.ca/geoserver/wcs",
      "layer": "nwt:fuel_types"
    }
  },
  "branding": {
    "agencyName": "NWT Wildfire Operations",
    "logo": "./assets/nwt-logo.png",
    "primaryColor": "#003366"
  },
  "features": {
    "enabled": ["model-setup", "model-review", "export"],
    "suppressedEngines": ["wise"]
  }
}
```

## SST Alignment

From R3-nomad-frontend.md:
> Configuration Service (living schema)

The "living schema" concept means the schema evolves as agencies onboard - new fields are added but existing ones remain stable.
