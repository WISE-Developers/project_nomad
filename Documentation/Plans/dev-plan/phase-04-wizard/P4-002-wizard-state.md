# P4-002: Wizard State Management

## Description
Implement state management for wizard data with localStorage persistence for draft models.

## Acceptance Criteria
- [ ] Create `useWizardState` hook for managing wizard form data
- [ ] Persist state to localStorage on each change
- [ ] Generate unique draft ID for each new wizard session
- [ ] Support multiple concurrent drafts
- [ ] Clear draft from localStorage on completion/cancel
- [ ] Debounce localStorage writes for performance

## Dependencies
- P4-001 (Wizard Container)

## Estimated Time
3 hours

## Files to Create/Modify
- `frontend/src/components/Wizard/useWizardState.ts`
- `frontend/src/utils/storage.ts`

## Notes
- Draft models live in localStorage until executed
- Consider storage limits (~5MB for localStorage)
- Add TTL for auto-cleanup of old drafts
