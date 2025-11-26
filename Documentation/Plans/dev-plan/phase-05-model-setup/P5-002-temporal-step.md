# P5-002: Temporal Parameters Step

## Description
Create the step for entering start date/time and model duration.

## Acceptance Criteria
- [ ] Create `TemporalStep` component
- [ ] Date picker for start date
- [ ] Time picker for start time
- [ ] Duration selector (hours or days)
- [ ] Validate date is not in future (or flag as forecast)
- [ ] Show timezone information
- [ ] Calculate and display end date/time

## Dependencies
- P4-001 (Wizard Container)
- P1-002 (TimeRange value object)

## Estimated Time
2-3 hours

## Files to Create/Modify
- `frontend/src/features/ModelSetup/steps/TemporalStep.tsx`

## Notes
- Date/time handling is tricky - use date-fns or dayjs
- Consider local vs UTC timezone display
