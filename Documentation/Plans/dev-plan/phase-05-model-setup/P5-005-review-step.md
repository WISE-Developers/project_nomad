# P5-005: Review and Execute Step

## Description
Create the final wizard step showing summary and execution options.

## Acceptance Criteria
- [ ] Create `ReviewStep` component
- [ ] Display summary of all inputs (geometry, time, model, weather)
- [ ] Show map preview with geometry
- [ ] Notification preference checkboxes (email, web push)
- [ ] Back button to modify inputs
- [ ] Start button to execute model
- [ ] Defer button to schedule for later (stub)

## Dependencies
- P4-001 (Wizard Container)
- All other P5 steps

## Estimated Time
3 hours

## Files to Create/Modify
- `frontend/src/features/ModelSetup/steps/ReviewStep.tsx`
- `frontend/src/features/ModelSetup/components/ModelSummary.tsx`

## Notes
- This is where the wizard connects to the backend API
- Show clear confirmation before starting execution
