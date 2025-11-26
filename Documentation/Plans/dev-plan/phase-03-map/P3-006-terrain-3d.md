# P3-006: 3D Terrain Toggle

## Description
Add 3D terrain visualization with user-adjustable exaggeration.

## Acceptance Criteria
- [ ] Create `TerrainControl` component
- [ ] Toggle 3D terrain on/off
- [ ] Slider for terrain exaggeration (1x to 3x)
- [ ] Use MapBox terrain-rgb source
- [ ] Adjust pitch for optimal 3D viewing
- [ ] Remember settings in localStorage

## Dependencies
- P3-001 (MapBox Wrapper)

## Estimated Time
2-3 hours

## Files to Create/Modify
- `frontend/src/components/Map/TerrainControl.tsx`

## Notes
- 3D terrain helps visualize fire behavior in mountainous areas
- Consider performance on mobile devices
- Default exaggeration should be subtle (1.5x)
