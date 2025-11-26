# P12-003: PostGIS Adapter Implementation

## Description
Implement spatial repository using PostGIS for ACN deployments.

## Acceptance Criteria
- [ ] Create `PostGISRepository` implementing ISpatialRepository
- [ ] Connect to PostGIS database via configuration
- [ ] Implement geometry storage with spatial index
- [ ] Implement spatial queries using PostGIS functions
- [ ] Handle connection pooling

## Dependencies
- P12-001 (Spatial Repository Interface)

## Estimated Time
4-5 hours

## Files to Create/Modify
- `backend/src/infrastructure/spatial/PostGISRepository.ts`
- `backend/src/infrastructure/spatial/PostGISConfig.ts`

## Notes
- PostGIS is PostgreSQL with spatial extensions
- Use pg package with connection pool
- Better for multi-user/enterprise deployments
