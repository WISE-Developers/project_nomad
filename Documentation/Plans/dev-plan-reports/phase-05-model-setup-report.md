# Phase 5: Model Setup Workflow - Implementation Report

**Date**: 2025-11-27
**Status**: Complete
**PR**: #72 (merged)

## Summary

Phase 5 implemented the complete 5-step Model Setup wizard for creating fire model runs, integrating Phase 4 Wizard components with Phase 3 Map components.

## Completed Micro-Sprints

### P5-001: Spatial Input Step
**Files Created:**
- `frontend/src/features/ModelSetup/steps/SpatialInputStep.tsx`
- `frontend/src/features/ModelSetup/components/CoordinateInput.tsx`
- `frontend/src/features/ModelSetup/components/GeometryUpload.tsx`
- `frontend/src/features/ModelSetup/hooks/useGeometrySync.ts`

**Key Features:**
- Three input methods: Draw on map, Enter coordinates, Upload file
- Tab-based UI switching between methods
- GeoJSON and KML file parsing
- Canada bounds validation (-141° to -52° longitude, 42° to 84° latitude)
- `useGeometrySync` hook bridges DrawContext with wizard data
- Feature list with individual deletion
- Map fly-to on geometry change

### P5-002: Temporal Step
**Files Created:**
- `frontend/src/features/ModelSetup/steps/TemporalStep.tsx`

**Key Features:**
- Native HTML date and time pickers
- Duration slider (1-720 hours / 30 days max)
- Preset buttons: 6h, 12h, 24h, 48h, 72h, 168h
- Auto-detect forecast vs historical based on date
- End date/time calculation
- Timezone display (read-only, browser timezone)

### P5-003: Model Selection Step
**Files Created:**
- `frontend/src/features/ModelSetup/steps/ModelSelectionStep.tsx`

**Key Features:**
- Engine selection: FireSTARR (active), WISE (coming soon, disabled)
- Run type: Deterministic vs Probabilistic
- Card-based selection UI with descriptions
- Info box explaining probabilistic runs

### P5-004: Weather Step
**Files Created:**
- `frontend/src/features/ModelSetup/steps/WeatherStep.tsx`
- `frontend/src/features/ModelSetup/components/FWIInput.tsx`
- `frontend/src/features/ModelSetup/components/WeatherUpload.tsx`

**Key Features:**
- Manual FWI input with 6 indices (FFMC, DMC, DC, ISI, BUI, FWI)
- Validation ranges from backend FWIIndices value object
- Fire danger rating display (Low to Extreme) with color coding
- "Use Spring Startup Values" preset button
- Weather file upload placeholder (coming soon)
- SpotWX integration placeholder (coming soon)

### P5-005: Review Step
**Files Created:**
- `frontend/src/features/ModelSetup/steps/ReviewStep.tsx`
- `frontend/src/features/ModelSetup/components/ModelSummary.tsx`

**Key Features:**
- Summary cards for each section (Spatial, Temporal, Model, Weather)
- Notification preferences checkboxes (stubs for MVP)
- Optional notes textarea
- Ready-to-run status indicator

### Supporting Files
**Files Created:**
- `frontend/src/features/ModelSetup/types/index.ts` - Core types and constants
- `frontend/src/features/ModelSetup/validators/index.ts` - Step validators
- `frontend/src/features/ModelSetup/hooks/useModelSetup.ts` - Wizard config factory
- `frontend/src/features/ModelSetup/components/ModelSetupWizard.tsx` - Main wrapper
- `frontend/src/features/ModelSetup/index.ts` - Barrel exports

## Directory Structure After Phase 5

```
frontend/src/features/ModelSetup/
├── components/
│   ├── CoordinateInput.tsx      # Manual lat/lng entry
│   ├── FWIInput.tsx             # 6-field FWI form
│   ├── GeometryUpload.tsx       # GeoJSON/KML upload
│   ├── ModelSetupWizard.tsx     # Main wizard wrapper
│   ├── ModelSummary.tsx         # Review display
│   └── WeatherUpload.tsx        # CSV upload (stub)
├── hooks/
│   ├── useGeometrySync.ts       # DrawContext ↔ wizard sync
│   └── useModelSetup.ts         # Wizard config factory
├── steps/
│   ├── SpatialInputStep.tsx     # Step 1
│   ├── TemporalStep.tsx         # Step 2
│   ├── ModelSelectionStep.tsx   # Step 3
│   ├── WeatherStep.tsx          # Step 4
│   └── ReviewStep.tsx           # Step 5
├── types/
│   └── index.ts                 # All types, constants, utilities
├── validators/
│   └── index.ts                 # Step validators
└── index.ts                     # Barrel exports
```

## Core Types

```typescript
interface ModelSetupData {
  geometry: {
    type: 'point' | 'line' | 'polygon' | 'none';
    features: DrawnFeature[];
    bounds?: BoundingBox;
    inputMethod: 'draw' | 'coordinates' | 'upload';
  };
  temporal: {
    startDate: string;
    startTime: string;
    durationHours: number;
    timezone: string;
    isForecast: boolean;
  };
  model: {
    engine: 'firestarr' | 'wise';
    runType: 'deterministic' | 'probabilistic';
  };
  weather: {
    source: 'manual' | 'upload' | 'spotwx';
    fwi?: FWIValues;
    uploadedFile?: string;
  };
  execution?: {
    notifyEmail: boolean;
    notifyPush: boolean;
    notes?: string;
  };
}
```

## App.tsx Integration

```tsx
<MapProvider>
  <MapContainer>
    <DrawProvider>
      {!showWizard && (
        <button onClick={handleNewModel}>🔥 New Fire Model</button>
      )}
      {showWizard && (
        <ModelSetupWizard
          onComplete={handleComplete}
          onCancel={handleCancel}
        />
      )}
      {!showWizard && (
        <>
          <DrawingToolbar />
          <MeasurementTool />
          <LayerPanel />
          <BasemapSwitcher />
          <TerrainControl />
        </>
      )}
    </DrawProvider>
  </MapContainer>
</MapProvider>
```

## Build Status

✅ `npm run build` passes with no errors

## Notes

- Wizard appears as overlay panel in top-right corner
- Map remains visible behind wizard for spatial context
- Draft persistence via localStorage (inherited from Phase 4)
- Validators enforce required fields before step progression
- Fire danger rating uses same thresholds as backend FWIIndices
- WISE engine and SpotWX marked as "Coming Soon" for MVP

## Next Steps

Phase 6 implements the Backend API for model execution, including:
- Express router setup
- Model execution service
- Job queue for async processing
- Health and status endpoints
