# Phase 2: Configuration System - Implementation Report

**Date**: 2025-11-27
**Status**: Complete
**PR**: #69 (merged)

## Summary

Phase 2 implemented the configuration system that enables agency-specific customization and supports both SAN (Stand Alone Nomad) and ACN (Agency Centric Nomad) deployment modes.

## Completed Work

### Infrastructure Layer Additions

**Files Created:**
- `backend/src/infrastructure/services/EnvironmentService.ts` - Environment variable handling
- `backend/src/infrastructure/services/ConfigurationLoader.ts` - Agency config loading with merge
- `configuration/generic/config.json` - Default generic configuration

### IEnvironmentService Implementation

```typescript
interface IEnvironmentService {
  get(key: string): string | undefined;
  getRequired(key: string): string;
  getNumber(key: string, defaultValue?: number): number;
  getBoolean(key: string, defaultValue?: boolean): boolean;
  getDeploymentMode(): 'SAN' | 'ACN';
  getAgencyId(): string | undefined;
}
```

**Key Features:**
- Type-safe environment variable access
- Default value support
- Deployment mode detection via `NOMAD_DEPLOYMENT_MODE`
- Agency ID via `NOMAD_AGENCY_ID`

### ConfigurationLoader Implementation

Implements `IConfigurationService` from Phase 1 interfaces.

**Key Features:**
- Loads from `configuration/{agencyId}/config.json` when agency set
- Falls back to `configuration/generic/config.json`
- Deep merges agency config over generic defaults
- Supports `suppressDefault` flag for data sources
- Caches loaded configuration

### Generic Configuration

Created `configuration/generic/config.json` with:
- Branding defaults (Nomad name/colors)
- Both WISE and FireSTARR engines enabled
- National data sources:
  - SpotWX weather API
  - National Fire Perimeter WFS
  - Canadian Fuel Type WCS
  - Canadian DEM 30m
  - MODIS/VIIRS hotspot services
- All export formats enabled (GeoJSON, KML, Shapefile, etc.)

## Directory Structure After Phase 2

```
backend/src/
├── infrastructure/
│   └── services/
│       ├── EnvironmentService.ts
│       └── ConfigurationLoader.ts
└── ...

configuration/
├── generic/
│   ├── config.json
│   └── README.md
└── (agency submodules go here)
```

## Configuration Schema

```typescript
interface AgencyConfiguration {
  agency: { id, name, logo, primaryColor, secondaryColor };
  engines: { wise: boolean; firestarr: boolean };
  dataSources: {
    weather: DataSourceConfig[];
    fuelTypes: DataSourceConfig[];
    terrain: DataSourceConfig[];
    fireBoundaries: DataSourceConfig[];
    hotspots: DataSourceConfig[];
  };
  features: { probabilisticModeling, historicalAnalysis, ... };
  exportFormats: string[];
  roles: Record<string, string>;
}
```

## Build Status

✅ `npm run build` passes with no errors

## Notes

- Configuration supports Git submodules for agency-specific configs
- Deep merge allows agencies to override only what they need
- `suppressDefault: true` hides national data sources when agencies provide their own
- Ready for agency onboarding via submodule addition

## Next Steps

Phase 3 implements the MapBox GL map components for the frontend.
