# P10-002: FGMJ Input File Generator

## Description
Create service to generate WISE FGMJ job files using the Builder pattern from wise_js_api.

## Acceptance Criteria
- [ ] Create `FGMJBuilder` class for constructing FGMJ files
- [ ] Support setting ignition geometry
- [ ] Support setting weather streams
- [ ] Support setting fuel grid references
- [ ] Support setting output configurations
- [ ] Generate valid FGMJ JSON output

## Dependencies
- P10-001 (WISE Adapter)

## Estimated Time
4 hours

## Files to Create/Modify
- `backend/src/infrastructure/engines/wise/FGMJBuilder.ts`
- `backend/src/infrastructure/engines/wise/FGMJTypes.ts`

## Notes
- Reference WiseGuy implementation for Builder pattern
- FGMJ is WISE's native job format
- Use prom.beginJobPromise() pattern from wise_js_api
