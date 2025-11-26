# P5-001: Spatial Input Step

## Description
Create the first wizard step for selecting or drawing the fire ignition geometry.

## Acceptance Criteria
- [ ] Create `SpatialInputStep` component
- [ ] Option to draw geometry on map (uses P3-002 drawing tools)
- [ ] Option to enter lat/long manually
- [ ] Option to upload geometry file (GeoJSON, KML, Shapefile)
- [ ] Display selected geometry on map preview
- [ ] Validate geometry is within supported bounds
- [ ] Support point (ignition), line (fire front), polygon (perimeter)

## Dependencies
- P4-001 (Wizard Container)
- P3-002 (Drawing Tools)

## Estimated Time
4 hours

## Files to Create/Modify
- `frontend/src/features/ModelSetup/steps/SpatialInputStep.tsx`
- `frontend/src/features/ModelSetup/components/GeometryUpload.tsx`
- `frontend/src/features/ModelSetup/components/CoordinateInput.tsx`

## Notes
- This is the most complex step due to multiple input methods
- Consider crosslink API for receiving geometry from external apps
