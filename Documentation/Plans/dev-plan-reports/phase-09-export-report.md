# Phase 9: Export Workflow - Implementation Report

## Overview

Phase 9 implemented the complete export workflow, enabling users to download model results in multiple formats (ZIP, KML, GeoJSON). Additionally, this phase integrated real FireSTARR execution, SSE-based job notifications, PWA support, and the Add to Map functionality.

## Implementation Summary

### Backend (Export Infrastructure)

**P9-001: Export Format Registry**

Created centralized format management:

1. **ExportFormatRegistry** (`backend/src/infrastructure/export/ExportFormatRegistry.ts`)
   - Singleton registry for available export formats
   - Format capabilities: id, name, extension, mime type, engine support
   - Methods: getFormat, listFormats, isSupported

2. **Supported Formats**
   - GeoTIFF (.tif) - Original raster data
   - GeoJSON (.geojson) - Vector contours
   - KML (.kml) - Google Earth compatible
   - Shapefile (.shp) - GIS standard (via ZIP)

**P9-002: Export Bundle Builder**

1. **ExportBundleBuilder** (`backend/src/infrastructure/export/ExportBundleBuilder.ts`)
   - Builds export packages from model results
   - Handles format conversion per output
   - Generates metadata.json with model info
   - Creates README.txt with bundle contents

**P9-003: ZIP Download**

1. **ZipGenerator** (`backend/src/infrastructure/export/ZipGenerator.ts`)
   - Streams ZIP archive creation using `archiver`
   - Adds files, buffers, and directories
   - Progress tracking via event emitter
   - Memory-efficient streaming to response

2. **Export Routes** (`backend/src/api/routes/v1/exports.ts`)
   - `POST /api/v1/exports/generate` - Generate export bundle
   - `GET /api/v1/exports/:exportId/download` - Download ZIP file
   - `GET /api/v1/exports/:exportId/status` - Check generation progress

**P9-004: Shareable Link Generation**

1. **ShareableLinkService** (`backend/src/infrastructure/export/ShareableLinkService.ts`)
   - Generates unique share tokens
   - Configurable expiration (default 7 days)
   - Access tracking and validation

**P9-005: Format Converter**

1. **FormatConverter** (`backend/src/infrastructure/export/FormatConverter.ts`)
   - GeoTIFF to GeoJSON (via ContourGenerator)
   - GeoJSON to KML (via tokml library)
   - Passthrough for native formats

### Backend (Real Execution & Notifications)

**SSE Job Streaming**
- `GET /api/v1/jobs/:id/stream` - Server-Sent Events endpoint
- Real-time status updates during model execution
- Heartbeat every 30 seconds to keep connection alive

**Weather Infrastructure**
1. **WeatherService** (`backend/src/infrastructure/weather/WeatherService.ts`)
   - Converts manual FWI input (FFMC, DMC, DC) to hourly weather.csv
   - Generates weather file for FireSTARR consumption
   - Hardcoded wind/temp/humidity defaults (TODO: add to UI)

**Execution Timestamps**
- Added `startedAt` and `completedAt` to ExecutionStatus interface
- Duration calculated from timestamps
- Displayed in Results Summary component

**Dynamic Output Offsets**
- `output_date_offsets` parameter calculated from simulation duration
- No more hardcoded [1,2,3,7,14] values
- Supports 1hr to 30 day simulations

**GDAL Integration**
- Added `gdal-async` dependency for raster processing
- Removed mock contour fallback - fail fast on errors
- Updated Dockerfile with GDAL libraries (node:22-slim base)

**Environment Consolidation**
- Single `.env` file at project root
- Backend loads via `dotenv.config({ path: '../.env' })`
- Frontend loads via Vite `envDir` option
- Deleted `backend/.env.example` and `frontend/.env.example`

### Frontend (Export Panel)

**P9-005: Export UI**

1. **ExportPanel** (`frontend/src/features/Export/components/ExportPanel.tsx`)
   - Format selection (ZIP, KML, GeoJSON)
   - Output selection checkboxes
   - Generation progress indicator
   - Download button when ready

2. **useExportGeneration** hook
   - Manages export generation state
   - Polls for completion status
   - Handles download triggering

### Frontend (Notifications & PWA)

**Job Status Toast**
- `JobStatusToast.tsx` - Floating notification for job progress
- Shows status, progress bar, and completion actions
- "View Results" button opens Model Review panel

**Notification Permission Banner**
- `NotificationPermissionBanner.tsx` - Requests push notification permission
- Dismissible, non-blocking UI

**useJobNotifications Hook**
- SSE connection to `/api/v1/jobs/:id/stream`
- Browser notification on completion
- Callbacks for complete/error states

**PWA Support**
- `manifest.json` - App manifest for home screen installation
- `sw.js` - Service worker for offline caching
- Updated `index.html` with manifest link and meta tags

### Frontend (Add to Map)

**handleAddToMap in App.tsx**
- Fetches GeoJSON from preview endpoint
- Adds source and layer to MapBox GL map
- Handles Polygon, Point, and Line geometries
- Orange styling (#ff6b35) for fire outputs

## File Changes

### New Files (Backend)
```
backend/src/api/routes/v1/exports.ts
backend/src/infrastructure/export/ExportBundleBuilder.ts
backend/src/infrastructure/export/ExportFormatRegistry.ts
backend/src/infrastructure/export/FormatConverter.ts
backend/src/infrastructure/export/ShareableLinkService.ts
backend/src/infrastructure/export/ZipGenerator.ts
backend/src/infrastructure/export/index.ts
backend/src/infrastructure/export/types.ts
backend/src/infrastructure/weather/WeatherService.ts
backend/src/infrastructure/weather/index.ts
backend/src/infrastructure/weather/types.ts
backend/src/types/tokml.d.ts
```

### Modified Files (Backend)
```
backend/package.json - Added gdal-async, tokml dependencies
backend/Dockerfile - GDAL installation, node:22-slim base
backend/src/api/routes/v1/index.ts - Added exports router
backend/src/api/routes/v1/jobs.ts - Added SSE streaming endpoint
backend/src/api/routes/v1/models.ts - Real execution integration
backend/src/application/interfaces/IFireModelingEngine.ts - Added timestamps
backend/src/application/services/ModelResultsService.ts - Use timestamps
backend/src/infrastructure/firestarr/ContourGenerator.ts - Fail fast, no mocks
backend/src/infrastructure/firestarr/FireSTARREngine.ts - Dynamic offsets, timestamps
backend/src/infrastructure/firestarr/FireSTARRInputGenerator.ts - Path resolution fix
backend/src/index.ts - Load .env from parent directory
```

### New Files (Frontend)
```
frontend/public/manifest.json
frontend/public/sw.js
frontend/src/features/Export/components/ExportPanel.tsx
frontend/src/features/Export/hooks/useExportGeneration.ts
frontend/src/features/Export/index.ts
frontend/src/features/Export/types/index.ts
frontend/src/features/Notifications/components/JobStatusToast.tsx
frontend/src/features/Notifications/components/NotificationPermissionBanner.tsx
frontend/src/features/Notifications/hooks/useJobNotifications.ts
frontend/src/features/Notifications/index.ts
frontend/src/services/api.ts
```

### Modified Files (Frontend)
```
frontend/index.html - PWA meta tags, manifest link
frontend/vite.config.ts - envDir for root .env
frontend/src/App.tsx - Real API calls, handleAddToMap, notifications
frontend/src/features/ModelReview/components/ModelReviewPanel.tsx - Export panel integration
frontend/src/features/ModelReview/components/OutputList.tsx - CSS fixes, removed broken icons
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/exports/generate` | Generate export bundle |
| GET | `/api/v1/exports/:exportId/download` | Download ZIP file |
| GET | `/api/v1/exports/:exportId/status` | Check generation progress |
| GET | `/api/v1/jobs/:id/stream` | SSE job status stream |

## Technical Decisions

1. **Fail Fast**: Removed all mock data fallbacks. Errors propagate with clear messages instead of silently returning fake Alberta coordinates.

2. **Single .env**: Consolidated environment variables to project root. Simplifies configuration and avoids duplication.

3. **SSE over WebSocket**: Chose Server-Sent Events for job notifications - simpler, unidirectional, and sufficient for status updates.

4. **Dynamic Output Offsets**: Calculate from simulation duration rather than hardcoding. Supports the full range of duration options in the UI.

5. **GDAL Required**: Made GDAL a hard requirement rather than optional. Updated Dockerfile and README with installation instructions.

6. **Streaming ZIP**: Use `archiver` with streaming to avoid memory issues with large exports.

## Integration Points

- **ExportPanel** integrates with ModelReviewPanel via modal overlay
- **useJobNotifications** connects to SSE endpoint and triggers browser notifications
- **handleAddToMap** uses MapBox GL API directly via useMap hook
- **WeatherService** generates weather.csv consumed by FireSTARR Docker container

## Testing

- Backend builds successfully with `npm run build`
- Frontend builds successfully with `npm run build`
- FireSTARR model executed successfully via Docker
- SSE job streaming verified in browser DevTools
- Export ZIP download verified

## Known Issues

1. Weather data uses hardcoded wind/temp/humidity - needs UI fields
2. Raster may be blank in cold/wet conditions (not fire season)
3. ContourGenerator needs actual raster data to produce valid contours

## Future Improvements

1. Add wind speed/direction/temperature/humidity to weather UI
2. Add SpotWX API integration for automatic weather
3. Add agency storage export destination
4. Add batch export for multiple models
5. Add export templates for common format combinations
