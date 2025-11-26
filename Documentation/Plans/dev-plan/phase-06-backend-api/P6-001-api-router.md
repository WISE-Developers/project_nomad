# P6-001: API Router Structure with Versioning

## Description
Set up the Express router structure with API versioning for future compatibility.

## Acceptance Criteria
- [ ] Create versioned router structure (/api/v1/...)
- [ ] Create route files: models, jobs, config, health
- [ ] Implement request logging middleware
- [ ] Add CORS configuration
- [ ] Add JSON body parsing with size limits
- [ ] Create API documentation stub (OpenAPI/Swagger)

## Dependencies
- Phase 0 (existing Express setup)

## Estimated Time
2-3 hours

## Files to Create/Modify
- `backend/src/api/routes/index.ts`
- `backend/src/api/routes/v1/models.ts`
- `backend/src/api/routes/v1/jobs.ts`
- `backend/src/api/routes/v1/config.ts`
- `backend/src/api/middleware/logging.ts`
- `backend/src/index.ts` (integrate routers)

## Notes
- v1 prefix allows breaking changes in future versions
- Keep routes thin - logic in services/use cases
