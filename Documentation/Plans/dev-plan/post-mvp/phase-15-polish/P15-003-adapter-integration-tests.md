# P15-003: Integration Tests for Adapters

## Description
Create integration tests for infrastructure adapters (database, engines).

## Acceptance Criteria
- [ ] Test SpatiaLite adapter with real database
- [ ] Test FireSTARR adapter with Docker container
- [ ] Test configuration loader with real files
- [ ] Use test containers or fixtures
- [ ] Handle test isolation and cleanup

## Dependencies
- Phase 7 (FireSTARR Adapter)
- Phase 12 (Spatial Database)

## Estimated Time
4-5 hours

## Files to Create/Modify
- `backend/src/infrastructure/__tests__/SpatiaLiteRepository.test.ts`
- `backend/src/infrastructure/__tests__/FireSTARREngine.test.ts`
- `backend/src/infrastructure/__tests__/ConfigurationLoader.test.ts`

## Notes
- Integration tests are slower, run separately
- Consider test database setup/teardown
