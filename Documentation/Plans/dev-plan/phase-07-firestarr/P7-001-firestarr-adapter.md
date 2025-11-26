# P7-001: FireSTARR Engine Adapter

## Description
Create the FireSTARR adapter implementing the IFireModelingEngine interface.

## Acceptance Criteria
- [ ] Create `FireSTARREngine` class implementing `IFireModelingEngine`
- [ ] Implement `initialize()` - verify engine availability
- [ ] Implement `execute()` - trigger model run with parameters
- [ ] Implement `getStatus()` - check execution status
- [ ] Implement `getResults()` - retrieve output files
- [ ] Handle FireSTARR-specific configuration

## Dependencies
- P1-003 (IFireModelingEngine interface)
- P6-002 (Model Execution Service)

## Estimated Time
4 hours

## Files to Create/Modify
- `backend/src/infrastructure/engines/firestarr/FireSTARREngine.ts`
- `backend/src/infrastructure/engines/firestarr/types.ts`
- `backend/src/infrastructure/engines/firestarr/index.ts`

## Notes
- Reference Documentation/Research/Onboarding/firestarr_io.md for I/O specs
- FireSTARR runs via docker compose run --rm firestarr-app
