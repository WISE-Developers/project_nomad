# P3-005: Measurement Tools

## Description
Add tools for measuring distances and areas on the map.

## Acceptance Criteria
- [ ] Create `MeasurementTool` component
- [ ] Support distance measurement (line)
- [ ] Support area measurement (polygon)
- [ ] Display measurements in metric units (km, km², ha)
- [ ] Show measurements as overlay on map
- [ ] Clear measurement button

## Dependencies
- P3-001 (MapBox Wrapper)
- P3-002 (Drawing Tools - for geometry input)

## Estimated Time
2-3 hours

## Files to Create/Modify
- `frontend/src/components/Map/MeasurementTool.tsx`
- `frontend/src/utils/geometry.ts` (calculation functions)

## Notes
- Use Turf.js for accurate geodesic calculations
- Consider showing intermediate measurements while drawing
