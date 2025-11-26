# P10-001: WISE Engine Adapter

## Description
Create the WISE fire modeling engine adapter implementing the IFireModelingEngine interface, enabling WISE as a second engine option.

## Acceptance Criteria
- [ ] Create `WISEEngine` class implementing `IFireModelingEngine`
- [ ] Implement `initialize()` - verify WISE availability
- [ ] Implement `execute()` - trigger WISE model run
- [ ] Implement `getStatus()` - check execution status
- [ ] Implement `getResults()` - retrieve WISE outputs
- [ ] Handle WISE-specific configuration and parameters

## Dependencies
- P1-003 (IFireModelingEngine interface)
- Phase 7 (FireSTARR - reference implementation)

## Estimated Time
4-5 hours

## Files to Create/Modify
- `backend/src/infrastructure/engines/wise/WISEEngine.ts`
- `backend/src/infrastructure/engines/wise/types.ts`
- `backend/src/infrastructure/engines/wise/index.ts`

## Notes
- Reference WiseGuy repository: /Users/franconogarin/localcode/wiseguy/
- WISE uses FGMJ file format for job configuration
- Consider Builder pattern for FGMJ generation
