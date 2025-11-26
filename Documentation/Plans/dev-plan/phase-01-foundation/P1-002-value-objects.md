# P1-002: Value Objects

## Description
Create immutable value objects that represent concepts without identity. These are used within entities and use cases.

## Acceptance Criteria
- [ ] Create `Coordinates` value object (latitude, longitude, optional elevation)
- [ ] Create `TimeRange` value object (start datetime, end datetime, duration)
- [ ] Create `FWIIndices` value object grouping all FWI components
- [ ] Create `BoundingBox` value object for spatial extents
- [ ] All value objects are immutable (readonly properties)
- [ ] Include validation in constructors
- [ ] Add equality comparison methods

## Dependencies
- P1-001 (Domain Entities)

## Estimated Time
2-3 hours

## Files to Create/Modify
- `backend/src/domain/value-objects/Coordinates.ts`
- `backend/src/domain/value-objects/TimeRange.ts`
- `backend/src/domain/value-objects/FWIIndices.ts`
- `backend/src/domain/value-objects/BoundingBox.ts`
- `backend/src/domain/value-objects/index.ts` (barrel export)

## Notes
- Value objects should be compared by value, not reference
- Consider factory methods for common creation patterns
- Validation errors should be descriptive
