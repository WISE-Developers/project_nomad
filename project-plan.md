# Project Nomad - Project Plan

**Last Updated:** 2026-01-13
**Repository:** [WISE-Developers/project_nomad](https://github.com/WISE-Developers/project_nomad)
**SME:** Sage

---

## Current Focus

**Phase 3: Frontend Architecture** - Building the embeddable component and agency integration layer.

**Active Work:**
- P3-002: Configuration Service (5 open issues)
- P3-004: Embeddable React Component (2 open issues)
- P3-006: PostgreSQL/PostGIS Repositories (4 open issues)
- P3-007: API Versioning (3 open issues)

---

## Milestone Status

### Phase 3 Technical Milestones

| Milestone | Status | Open | Closed | Notes |
|-----------|--------|------|--------|-------|
| [P3-001: Core Abstraction Layer](https://github.com/WISE-Developers/project_nomad/milestone/9) | **Complete** | 0 | 4 | Mode detection, context provider, service factory, integration tests |
| [P3-002: Configuration Service](https://github.com/WISE-Developers/project_nomad/milestone/10) | In Progress | 5 | 0 | Schema v2, loader refactor, submodule support, frontend context, tests |
| [P3-003: Auth Abstraction](https://github.com/WISE-Developers/project_nomad/milestone/11) | **Complete** | 0 | 5 | Provider interface, OIDC, SAML, role mapping, tests |
| [P3-004: Embeddable React Component](https://github.com/WISE-Developers/project_nomad/milestone/12) | In Progress | 2 | 2 | Entry point done, embed config done; library build + docs pending |
| [P3-005: Agency Data Services](https://github.com/WISE-Developers/project_nomad/milestone/13) | **Complete** | 0 | 4 | Interface, WFS client, WCS client, integration tests |
| [P3-006: PostgreSQL/PostGIS](https://github.com/WISE-Developers/project_nomad/milestone/14) | Not Started | 4 | 0 | Connection manager, model repo, spatial repo, migrations |
| [P3-007: API Versioning](https://github.com/WISE-Developers/project_nomad/milestone/15) | Not Started | 3 | 0 | Header middleware, versioned routes, deprecation warnings |
| [P3-S2: Dashboard & openNomad](https://github.com/WISE-Developers/project_nomad/milestone/17) | **Complete** | 0 | 6 | API interface, default impl, dashboard, context, guide, tests |

### Delivery Milestones

| Milestone | Status | Open | Closed | Notes |
|-----------|--------|------|--------|-------|
| [NWT MVP Prototype](https://github.com/WISE-Developers/project_nomad/milestone/5) | In Progress | 1 | 35 | Primary delivery target |
| [NWT Working FireSTARR](https://github.com/WISE-Developers/project_nomad/milestone/4) | **Complete** | 0 | 3 | FireSTARR instance operational |
| [Nomad Local Install](https://github.com/WISE-Developers/project_nomad/milestone/16) | In Progress | 1 | 1 | Installation documentation |

### Future Agency Onboarding

| Milestone | Status | Notes |
|-----------|--------|-------|
| [Agency Integration Case Study](https://github.com/WISE-Developers/project_nomad/milestone/18) | Planned | 5 open - Co-authored with Meridian after EM3 integration |
| [Alberta Onboarded](https://github.com/WISE-Developers/project_nomad/milestone/1) | Planned | 1 open |
| [Ontario Onboarded](https://github.com/WISE-Developers/project_nomad/milestone/2) | Planned | 1 open |
| [Simple Model Onboarding Docs](https://github.com/WISE-Developers/project_nomad/milestone/6) | **Complete** | 4/4 closed - WISE & FireSTARR I/O and Tech Summaries |
| [FireSTARR Install from Nomad](https://github.com/WISE-Developers/project_nomad/milestone/7) | **Complete** | 0 open, 1 closed |
| [WISE Install from Nomad](https://github.com/WISE-Developers/project_nomad/milestone/8) | Pending | 2 open |

---

## Active Issues

### P3-002: Configuration Service
- [ ] #82: Configuration Schema v2
- [ ] #83: Configuration Loader Refactor
- [ ] #84: Agency Configuration Git Submodule Support
- [ ] #85: Frontend Configuration Context
- [ ] #86: Configuration Integration Tests

### P3-004: Embeddable React Component
- [x] #92: Component Entry Point
- [x] #93: Embed Configuration API
- [ ] #94: Library Build Configuration
- [ ] #95: Component Documentation
- [ ] **NEW: Agency White-Label Customization Contract**

#### White-Label Requirements (ACN Mode)

Agencies embedding Nomad must be able to fully customize the UI to match their system. The component must expose:

**Theming (CSS Variables)**
- Colors, fonts, spacing, borders, border-radius
- Exposed via `--nomad-*` CSS custom properties

**Labels (i18n/Branding)**
- Dashboard title
- Tab names
- Button text
- Tooltips and placeholders
- Via `labels` prop with full override capability

**Actions (Agency Buttons)**
- Add custom buttons with placement control (toolbar, sidebar, results panel, map overlay)
- Via `actions` array prop: `{ label, icon?, placement, onClick }`

**Slots (Component Extension)**
- Replace or extend: header, toolbar, sidebar, panels
- Via `slots` prop with render props pattern: `slots={{ toolbar: (defaults) => <>{defaults}<Custom /></> }}`

**Feature Flags**
- Show/hide Nomad capabilities agency doesn't need
- Via `features` prop: `{ export: true, compare: false, ... }`

**API Shape:**
```tsx
<NomadDashboard
  title="Agency Fire Modeling"
  labels={{ tabs: {...}, buttons: {...} }}
  theme={{ '--nomad-primary': '#agency-blue' }}
  actions={[{ label: 'Export', placement: 'toolbar', onClick }]}
  slots={{ toolbar: (defaults) => <>{defaults}<AgencyTools /></> }}
  features={{ export: true, compare: false }}
/>
```

Or via provider for multi-component configs:
```tsx
<NomadProvider config={agencyConfig}>
  <NomadDashboard />
</NomadProvider>
```

### P3-006: PostgreSQL/PostGIS Repositories
- [ ] #100: PostgreSQL Connection Manager
- [ ] #101: PostGIS Model Repository
- [ ] #102: PostGIS Spatial Repository
- [ ] #103: Database Migration System

### P3-007: API Versioning
- [ ] #104: API Version Header Middleware
- [ ] #105: Versioned Route Structure
- [ ] #106: Deprecation Warning System

### Other Active
- [ ] #114: Build FireSTARR for old Opteron server

---

## Completed This Phase

### P3-001: Core Abstraction Layer (Sprint 1)
- [x] #78: Deployment Mode Detection
- [x] #79: Mode Context Provider (Frontend)
- [x] #80: Mode-Aware Service Factory
- [x] #81: Core Abstraction Integration Tests

### P3-003: Auth Abstraction
- [x] #87: Auth Provider Interface
- [x] #88: OIDC/OAuth 2.0 Implementation
- [x] #89: SAML 2.0 Implementation
- [x] #90: Role Mapping Service
- [x] #91: Auth Integration Tests

### P3-005: Agency Data Services
- [x] #96: Agency Data Service Interface
- [x] #97: WFS Client Implementation
- [x] #98: WCS Client Implementation
- [x] #99: Agency Data Integration Tests

### P3-S2: Dashboard & openNomad
- [x] #108: Define openNomad API Interface Contract
- [x] #109: Extract Dashboard Component
- [x] #110: Default openNomad Implementation (SAN)
- [x] #111: OpenNomadProvider Context
- [x] #112: openNomad Agency Integration Guide
- [x] #113: Dashboard + openNomad Integration Tests

---

## Key Decisions

1. **Clean Architecture** - All code follows Uncle Bob's layered architecture with strict dependency rules
2. **SOLID Principles** - Non-negotiable requirement for all components
3. **Dual Deployment** - SAN (standalone) and ACN (agency-integrated) modes
4. **Engine Abstraction** - WISE and FireSTARR via common interface (from WiseGuy patterns)

---

## Reference Documentation

- **Detailed Specification:** `Documentation/Plans/project_plan.md`
- **Architecture:** `Documentation/Plans/dev-plan/`
- **README:** Project overview and quick start

---

*Sage - Wild Unicorn, Fourth Daughter*
*Bridging legacy WISE knowledge into modern fire modeling*
