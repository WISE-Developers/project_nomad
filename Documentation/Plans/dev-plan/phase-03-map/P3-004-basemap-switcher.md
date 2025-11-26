# P3-004: Basemap Switcher

## Description
Implement basemap selection between Physical, Streets, and Satellite views.

## Acceptance Criteria
- [ ] Create `BasemapSwitcher` component
- [ ] Support Physical/Terrain basemap
- [ ] Support Streets basemap
- [ ] Support Satellite basemap
- [ ] Preserve user layers when switching basemaps
- [ ] Remember last selected basemap in localStorage

## Dependencies
- P3-001 (MapBox Wrapper)

## Estimated Time
2 hours

## Files to Create/Modify
- `frontend/src/components/Map/BasemapSwitcher.tsx`
- `frontend/src/constants/basemaps.ts`

## Notes
- Use MapBox standard styles or custom styles
- Transition should be smooth (no flicker)
