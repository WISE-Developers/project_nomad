# P12-002: SpatiaLite Adapter Implementation

## Description
Implement spatial repository using SpatiaLite for SAN deployments.

## Acceptance Criteria
- [ ] Create `SpatiaLiteRepository` implementing ISpatialRepository
- [ ] Initialize SpatiaLite database with spatial extensions
- [ ] Implement geometry storage with spatial index
- [ ] Implement spatial queries (ST_Within, ST_Intersects)
- [ ] Handle coordinate reference systems (CRS)

## Dependencies
- P12-001 (Spatial Repository Interface)

## Estimated Time
4-5 hours

## Files to Create/Modify
- `backend/src/infrastructure/spatial/SpatiaLiteRepository.ts`
- `backend/src/infrastructure/spatial/SpatiaLiteInit.ts`

## Notes
- SpatiaLite is SQLite with spatial extensions
- Use better-sqlite3 with spatialite extension
- Good for single-user/small deployments
