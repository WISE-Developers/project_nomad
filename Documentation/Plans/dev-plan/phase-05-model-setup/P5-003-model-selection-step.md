# P5-003: Model Selection Step

## Description
Create the step for selecting the fire modeling engine and run type.

## Acceptance Criteria
- [ ] Create `ModelSelectionStep` component
- [ ] Radio buttons for engine selection (initially FireSTARR only)
- [ ] Radio buttons for run type (deterministic vs probabilistic)
- [ ] Show brief description of each option
- [ ] Grey out/hide unavailable engines based on config
- [ ] Validate selection made before proceeding

## Dependencies
- P4-001 (Wizard Container)
- P2-002 (Configuration for available models)

## Estimated Time
2 hours

## Files to Create/Modify
- `frontend/src/features/ModelSetup/steps/ModelSelectionStep.tsx`

## Notes
- Post-MVP will add WISE option
- Probabilistic runs take longer but provide uncertainty estimates
