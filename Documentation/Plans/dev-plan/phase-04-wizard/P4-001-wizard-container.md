# P4-001: Wizard Container Component

## Description
Create the reusable wizard container that handles step navigation, used by Model Setup, Review, and Export workflows.

## Acceptance Criteria
- [ ] Create `Wizard` container component accepting step configuration
- [ ] Implement forward/back navigation between steps
- [ ] Disable back on first step, change forward to "Finish" on last step
- [ ] Show current step content via render prop or children
- [ ] Support step skipping when marked as optional
- [ ] Emit events for step change and completion

## Dependencies
- Phase 1 complete (domain types for wizard data)

## Estimated Time
3-4 hours

## Files to Create/Modify
- `frontend/src/components/Wizard/Wizard.tsx`
- `frontend/src/components/Wizard/WizardContext.tsx`
- `frontend/src/components/Wizard/types.ts`
- `frontend/src/components/Wizard/index.ts`

## Notes
- Keep wizard generic - specific steps are in Phase 5
- Consider keyboard navigation (Enter for next, Escape for back)
