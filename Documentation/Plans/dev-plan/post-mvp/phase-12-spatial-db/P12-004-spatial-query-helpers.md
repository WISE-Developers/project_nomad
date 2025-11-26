# P12-004: Spatial Query Helpers

## Description
Create utility functions for common spatial queries.

## Acceptance Criteria
- [ ] `findModelsWithinDistance(point, radius)` - models near a location
- [ ] `findOverlappingPerimeters(geometry)` - intersecting fire perimeters
- [ ] `findModelsByZone(zoneId)` - models in fire management zone
- [ ] `calculateFireSpread(perimeters)` - perimeter change analysis
- [ ] Performance optimization with spatial indices

## Dependencies
- P12-002 or P12-003 (Spatial Adapter)

## Estimated Time
3-4 hours

## Files to Create/Modify
- `backend/src/application/services/SpatialQueryService.ts`

## Notes
- These queries support operational decision-making
- Consider caching frequently accessed results
