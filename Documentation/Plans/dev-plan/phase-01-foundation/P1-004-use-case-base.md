# P1-004: Use Case Base Class and Error Handling

## Description
Create the base infrastructure for use cases including error types, result handling, and the base use case pattern.

## Acceptance Criteria
- [ ] Create `UseCase<TRequest, TResponse>` abstract base class
- [ ] Create `Result<T>` type for success/failure handling (no exceptions for business errors)
- [ ] Create domain error types: `ValidationError`, `NotFoundError`, `EngineError`
- [ ] Create `DomainError` base class with code and message
- [ ] Add example use case skeleton for reference

## Dependencies
- P1-001 (Domain Entities)
- P1-002 (Value Objects)
- P1-003 (Application Interfaces)

## Estimated Time
2-3 hours

## Files to Create/Modify
- `backend/src/application/use-cases/UseCase.ts`
- `backend/src/application/common/Result.ts`
- `backend/src/domain/errors/DomainError.ts`
- `backend/src/domain/errors/ValidationError.ts`
- `backend/src/domain/errors/NotFoundError.ts`
- `backend/src/domain/errors/EngineError.ts`
- `backend/src/domain/errors/index.ts` (barrel export)

## Notes
- Use the Result pattern instead of throwing exceptions for expected errors
- Unexpected errors (bugs) can still throw
- Consider using discriminated unions for Result type
