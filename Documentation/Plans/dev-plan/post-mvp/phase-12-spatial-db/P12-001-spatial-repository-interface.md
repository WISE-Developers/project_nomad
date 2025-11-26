# P12-001: Spatial Repository Interface

## Description
Define the interface for spatial data operations that can be implemented by SpatiaLite or PostGIS.

## Acceptance Criteria
- [ ] Create `ISpatialRepository` interface extensions
- [ ] Define spatial query methods (within, intersects, contains)
- [ ] Define spatial indexing methods
- [ ] Define geometry storage methods
- [ ] Support GeoJSON input/output

## Dependencies
- P1-003 (Base ISpatialRepository)

## Estimated Time
2 hours

## Files to Create/Modify
- `backend/src/application/interfaces/ISpatialRepository.ts` (extend)
- `backend/src/domain/spatial/SpatialQuery.ts`

## Notes
- Interface must abstract SpatiaLite vs PostGIS differences
- Use GeoJSON as common interchange format
