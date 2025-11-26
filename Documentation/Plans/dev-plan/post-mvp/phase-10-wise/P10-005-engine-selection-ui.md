# P10-005: Engine Selection UI Enhancement

## Description
Update the model selection wizard step to support choosing between FireSTARR and WISE engines.

## Acceptance Criteria
- [ ] Update `ModelSelectionStep` with WISE option
- [ ] Show engine-specific descriptions and capabilities
- [ ] Indicate engine availability based on configuration
- [ ] Show estimated run time differences
- [ ] Remember user's preferred engine

## Dependencies
- P5-003 (Model Selection Step)
- P10-001 (WISE Adapter)

## Estimated Time
2 hours

## Files to Create/Modify
- `frontend/src/features/ModelSetup/steps/ModelSelectionStep.tsx`
- `frontend/src/constants/engines.ts`

## Notes
- Engine availability controlled by configuration
- Some agencies may only have one engine available
