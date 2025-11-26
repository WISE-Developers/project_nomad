# P12-005: Model Storage with Spatial Indexing

## Description
Implement model storage with spatial indexing for efficient queries.

## Acceptance Criteria
- [ ] Create model table with spatial column
- [ ] Index model locations for fast lookup
- [ ] Store model extents (bounding box)
- [ ] Support model search by location
- [ ] Migrate from file-based to database storage

## Dependencies
- P12-001 to P12-004 (Spatial infrastructure)
- P6-003 (Job Queue - for model metadata)

## Estimated Time
3-4 hours

## Files to Create/Modify
- `backend/src/infrastructure/repositories/ModelRepository.ts`
- `backend/src/infrastructure/spatial/migrations/001_create_models_table.sql`

## Notes
- Models have both point (ignition) and extent (result bounds)
- Spatial index enables efficient "models in this area" queries
