# P4-003: Step Validation Framework

## Description
Create a validation system for wizard steps that prevents progression until requirements are met.

## Acceptance Criteria
- [ ] Create `ValidationResult` type with errors array
- [ ] Create `StepValidator` interface for step-specific validation
- [ ] Integrate validation with Wizard navigation
- [ ] Display validation errors in UI
- [ ] Support async validation (e.g., checking coordinates)
- [ ] Validate on blur and on next button click

## Dependencies
- P4-001 (Wizard Container)
- P4-002 (Wizard State)

## Estimated Time
2-3 hours

## Files to Create/Modify
- `frontend/src/components/Wizard/validation.ts`
- `frontend/src/components/Wizard/ValidationErrors.tsx`

## Notes
- Each wizard step implements its own validator
- Keep error messages user-friendly
