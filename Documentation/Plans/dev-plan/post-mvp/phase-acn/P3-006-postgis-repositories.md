# P3-006: PostgreSQL/PostGIS Repositories

**Status**: DESCOPED (2025-01-15)

**GitHub Milestone**: [P3-006: PostgreSQL/PostGIS Repositories](https://github.com/WISE-Developers/project_nomad/milestone/14)

## Scope Change

**Original scope**: Nomad would implement and manage PostgreSQL/PostGIS repositories for ACN deployments.

**Revised understanding**: In ACN mode, the agency provides their own database infrastructure. Nomad embeds as a component into agency systems via the `openNomad` API. The agency implements repository adapters against our interfaces - they own the database.

This was validated through EM3 integration experience:
- EM3 has its own PostgreSQL database
- EM3 implements `IAuthProvider`, `IModelRepository`, etc.
- Nomad never directly touches the agency database

## What Remains In Scope

### Interface Contracts (Already Complete)
The repository interfaces that agencies implement are defined and stable:
- `IModelRepository` - fire model persistence
- `IJobRepository` - job tracking
- `IResultRepository` - results storage
- `ISpatialRepository` - spatial operations

### Reference Implementation (Already Complete)
- `ExampleAgencyAdapter.ts` - template showing agencies how to implement adapters
- Documentation on interface contracts

### Documentation (Needed)
- [ ] **P3-006-01**: Agency Integration Guide documenting how to wire agency PostgreSQL to Nomad interfaces

## What Is Out Of Scope

The following are **agency responsibilities**, not Nomad responsibilities:

- PostgreSQL connection management and pooling
- PostGIS spatial repository implementations
- Database schema design and migrations
- Database performance tuning and indexing

Agencies have existing database infrastructure. They implement adapters to connect it to Nomad's interfaces.

## Architecture (Revised)

```
┌─────────────────────────────────────────────────────────┐
│                    Nomad Component                       │
│              (via openNomad API)                        │
└───────────────────────┬─────────────────────────────────┘
                        │ Interface Contracts
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
│   Nomad owns DB     │   │   Agency owns DB    │
│   SQLite/SpatiaLite │   │   Agency implements │
│   (our code)        │   │   adapters          │
└─────────────────────┘   └─────────────────────┘
```

## Remaining Task

### P3-006-01: Agency Integration Guide

**Description**: Document how agencies connect their PostgreSQL/PostGIS to Nomad interfaces.

**Acceptance Criteria**:
- [ ] Document each repository interface contract
- [ ] Provide PostgreSQL implementation examples (non-functional reference)
- [ ] Document recommended schema patterns
- [ ] Show example adapter wiring

**Files to Create/Modify**:
- `Documentation/Integration/agency-database-guide.md`

This is documentation only - no code implementation needed.
