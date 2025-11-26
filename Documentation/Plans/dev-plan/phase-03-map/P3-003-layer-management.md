# P3-003: Layer Management (Add/Remove/Opacity)

## Description
Create layer management system for displaying model outputs and data overlays.

## Acceptance Criteria
- [ ] Create `LayerManager` component/service
- [ ] Support adding GeoJSON layers dynamically
- [ ] Support adding raster (TIF) layers
- [ ] Implement opacity slider per layer
- [ ] Implement layer visibility toggle
- [ ] Implement layer reordering (drag and drop)
- [ ] Create `LayerPanel` UI component

## Dependencies
- P3-001 (MapBox Wrapper)

## Estimated Time
4 hours

## Files to Create/Modify
- `frontend/src/components/Map/LayerManager.ts`
- `frontend/src/components/Map/LayerPanel.tsx`
- `frontend/src/components/Map/LayerItem.tsx`

## Notes
- Layers will display fire perimeters, intensity grids, probability maps
- Consider layer groups for organizing related layers
