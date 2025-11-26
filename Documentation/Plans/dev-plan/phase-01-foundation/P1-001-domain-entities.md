# P1-001: Domain Entities

## Description
Create the core domain entities for the fire modeling system following Clean Architecture principles. These entities represent the fundamental business objects and contain no framework dependencies.

## Acceptance Criteria
- [ ] Create `FireModel` entity with properties: id, name, engine type, status, created/updated timestamps
- [ ] Create `SpatialGeometry` entity supporting point, line, and polygon geometries
- [ ] Create `WeatherData` entity with FWI system components (FFMC, DMC, DC, ISI, BUI, FWI)
- [ ] Create `FuelType` entity with fuel code, name, and properties
- [ ] Create `ModelResult` entity for storing execution outputs
- [ ] All entities are pure TypeScript classes with no external dependencies
- [ ] Add JSDoc documentation for all public methods and properties

## Dependencies
- None (first task)

## Estimated Time
3-4 hours

## Files to Create/Modify
- `backend/src/domain/entities/FireModel.ts`
- `backend/src/domain/entities/SpatialGeometry.ts`
- `backend/src/domain/entities/WeatherData.ts`
- `backend/src/domain/entities/FuelType.ts`
- `backend/src/domain/entities/ModelResult.ts`
- `backend/src/domain/entities/index.ts` (barrel export)

## Notes
- Follow TypeScript strict mode conventions
- Use readonly properties where appropriate
- Consider using branded types for IDs (e.g., `FireModelId`)
- Reference project_plan.md Architecture Principles section
