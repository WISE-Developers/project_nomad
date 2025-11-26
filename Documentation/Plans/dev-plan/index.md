<p align="center">
  <img src="../../../assets/logo/nomad-logo.png" alt="Project Nomad Logo" width="200"/>
</p>

# Project Nomad Development Plan

## Overview

This development plan breaks down the Project Nomad specification into small, actionable work chunks (2-4 hours each). Each task can be executed by a developer, AI agent, or collaborator.

**Source Specification:** [project_plan.md](../project_plan.md)

## Quick Stats

| Metric | Count |
|--------|-------|
| Total Phases | 15 |
| MVP Phases | 9 |
| Post-MVP Phases | 6 |
| Total Tasks | ~65 |
| Estimated MVP Hours | ~120-180 |

## Phase Overview

### MVP Phases (1-9)

| Phase | Name | Tasks | Focus |
|-------|------|-------|-------|
| 0 | Foundation | Done | TypeScript environment, Docker, scripts |
| 1 | [Clean Architecture](./phase-01-foundation/) | 4 | Domain entities, interfaces, use case patterns |
| 2 | [Configuration](./phase-02-configuration/) | 4 | JSON config, env vars, agency support |
| 3 | [Map Integration](./phase-03-map/) | 6 | MapBox GL, drawing, layers, terrain |
| 4 | [Wizard Framework](./phase-04-wizard/) | 5 | Reusable wizard, state, validation |
| 5 | [Model Setup](./phase-05-model-setup/) | 6 | Wizard steps for model configuration |
| 6 | [Backend API](./phase-06-backend-api/) | 5 | Express routes, job queue, status |
| 7 | [FireSTARR](./phase-07-firestarr/) | 4 | Engine adapter, I/O, Docker integration |
| 8 | [Model Review](./phase-08-model-review/) | 5 | Results display, map preview |
| 9 | [Export](./phase-09-export/) | 5 | Formats, ZIP, shareable links |

### Post-MVP Phases (10-15)

| Phase | Name | Tasks | Focus |
|-------|------|-------|-------|
| 10 | [WISE Integration](./post-mvp/phase-10-wise/) | 5 | Second fire modeling engine |
| 11 | [Auth & Roles](./post-mvp/phase-11-auth/) | 5 | SAN/ACN authentication |
| 12 | [Spatial Database](./post-mvp/phase-12-spatial-db/) | 5 | SpatiaLite/PostGIS |
| 13 | [Notifications](./post-mvp/phase-13-notifications/) | 5 | Web push, email alerts |
| 14 | [PWA & Mobile](./post-mvp/phase-14-pwa/) | 6 | Offline, installable, responsive |
| 15 | [Polish & Testing](./post-mvp/phase-15-polish/) | 6 | E2E tests, performance, a11y |

## Dependency Graph

```
Phase 0 (Done)
    │
    ▼
Phase 1: Clean Architecture ─────────────────────────┐
    │                                                 │
    ▼                                                 │
Phase 2: Configuration                                │
    │                                                 │
    ├────────────────┬────────────────┐              │
    ▼                ▼                ▼              │
Phase 3: Map    Phase 4: Wizard   Phase 6: API ◄────┘
    │                │                │
    │                ▼                │
    │           Phase 5: Model Setup  │
    │                │                │
    └────────────────┼────────────────┘
                     │
                     ▼
              Phase 7: FireSTARR
                     │
          ┌─────────┴─────────┐
          ▼                   ▼
    Phase 8: Review     Phase 9: Export
          │                   │
          └─────────┬─────────┘
                    │
            ════════════════
               MVP DONE
            ════════════════
                    │
    ┌───────────────┼───────────────┐
    ▼               ▼               ▼
Phase 10:      Phase 11:       Phase 12:
WISE           Auth            Spatial DB
    │               │               │
    └───────────────┼───────────────┘
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
    Phase 13:           Phase 14:
    Notifications       PWA & Mobile
          │                   │
          └─────────┬─────────┘
                    ▼
              Phase 15:
              Polish & Testing
```

## Task Status Legend

Each task file uses checkbox status:
- `[ ]` - Not started
- `[~]` - In progress
- `[x]` - Completed

## How to Use This Plan

### For Developers

1. Pick a task from the current phase
2. Check dependencies are complete
3. Read the task file for acceptance criteria
4. Implement and test
5. Mark checkboxes as complete
6. Commit with task ID in message (e.g., `P1-001: Add domain entities`)

### For AI Agents

1. Read task file completely
2. Follow acceptance criteria exactly
3. Create/modify only listed files
4. Run tests if specified
5. Report completion status

### For Project Managers

1. Track progress via checkbox status
2. Phases can parallelize where dependencies allow
3. MVP cutoff is after Phase 9
4. Estimate: 2-4 hours per task

## Architecture Reference

All code follows Clean Architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                    Frameworks & Drivers                      │
│  (React, MapBox GL, Express, SpatiaLite/PostGIS, Docker)    │
├─────────────────────────────────────────────────────────────┤
│                    Interface Adapters                        │
│  (Controllers, Presenters, Gateways, API Routes)            │
├─────────────────────────────────────────────────────────────┤
│                       Use Cases                              │
│  (Application Business Rules - Workflows, Model Execution)  │
├─────────────────────────────────────────────────────────────┤
│                        Entities                              │
│  (Enterprise Business Rules - Fire Models, Spatial Data)    │
└─────────────────────────────────────────────────────────────┘
```

**Dependency Rule:** Dependencies point inward only.

## Getting Started

Start with **Phase 1** tasks in order:
1. [P1-001: Domain Entities](./phase-01-foundation/P1-001-domain-entities.md)
2. [P1-002: Value Objects](./phase-01-foundation/P1-002-value-objects.md)
3. [P1-003: Application Interfaces](./phase-01-foundation/P1-003-application-interfaces.md)
4. [P1-004: Use Case Base](./phase-01-foundation/P1-004-use-case-base.md)
