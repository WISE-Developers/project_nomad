# P1-003: Application Interfaces

## Description
Define the interfaces (abstractions) that the application layer uses to interact with external systems. These enable dependency inversion and testability.

## Acceptance Criteria
- [ ] Create `IFireModelingEngine` interface with methods: initialize, execute, getStatus, getResults
- [ ] Create `IWeatherRepository` interface for fetching weather data
- [ ] Create `ISpatialRepository` interface for spatial data operations
- [ ] Create `IModelRepository` interface for persisting fire models
- [ ] Create `IConfigurationService` interface for accessing configuration
- [ ] All interfaces use domain types only (no framework types)
- [ ] Include JSDoc with method descriptions

## Dependencies
- P1-001 (Domain Entities)
- P1-002 (Value Objects)

## Estimated Time
2-3 hours

## Files to Create/Modify
- `backend/src/application/interfaces/IFireModelingEngine.ts`
- `backend/src/application/interfaces/IWeatherRepository.ts`
- `backend/src/application/interfaces/ISpatialRepository.ts`
- `backend/src/application/interfaces/IModelRepository.ts`
- `backend/src/application/interfaces/IConfigurationService.ts`
- `backend/src/application/interfaces/index.ts` (barrel export)

## Notes
- These interfaces will be implemented by adapters in Phase 7 (FireSTARR) and Phase 10 (WISE)
- Keep interfaces focused (Interface Segregation Principle)
- Consider async/Promise return types for I/O operations
