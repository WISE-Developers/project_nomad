# P3-001: MapBox GL React Component Wrapper

## Description
Create the base MapBox GL JS wrapper component for React with proper lifecycle management.

## Acceptance Criteria
- [ ] Create `MapContainer` React component wrapping MapBox GL
- [ ] Handle map initialization and cleanup on unmount
- [ ] Accept initial center, zoom, and style as props
- [ ] Expose map instance via ref or context for child components
- [ ] Handle MapBox access token from environment
- [ ] Add loading state while map initializes

## Dependencies
- Phase 2 complete (for config/env handling)

## Estimated Time
3-4 hours

## Files to Create/Modify
- `frontend/src/components/Map/MapContainer.tsx`
- `frontend/src/components/Map/MapContext.tsx`
- `frontend/src/components/Map/index.ts`
- `frontend/.env.example` (add VITE_MAPBOX_TOKEN)

## Notes
- Use mapbox-gl package (add to frontend dependencies)
- Consider react-map-gl wrapper vs raw mapbox-gl
- Ensure proper cleanup to prevent memory leaks
