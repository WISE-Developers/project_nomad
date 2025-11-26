# P6-004: Enhanced Health and Info Endpoints

## Description
Enhance existing health endpoint and add system information endpoint.

## Acceptance Criteria
- [ ] Enhance /api/health with detailed status
- [ ] Add database connection check (when implemented)
- [ ] Add model engine availability check
- [ ] Create /api/info endpoint with version, capabilities
- [ ] Add /api/config endpoint for public configuration
- [ ] Return appropriate HTTP status codes

## Dependencies
- P6-001 (API Router)

## Estimated Time
2 hours

## Files to Create/Modify
- `backend/src/api/routes/v1/health.ts`
- `backend/src/api/routes/v1/info.ts`
- `backend/src/index.ts` (update existing /api/health)

## Notes
- Health endpoint used by monitoring and load balancers
- Don't expose sensitive info in public endpoints
