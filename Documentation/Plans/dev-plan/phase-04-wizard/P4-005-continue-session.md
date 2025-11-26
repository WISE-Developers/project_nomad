# P4-005: Continue Where You Left Off

## Description
Implement the dashboard view showing draft models and ability to resume editing.

## Acceptance Criteria
- [ ] Create `DraftsDashboard` component
- [ ] List all draft models from localStorage
- [ ] Show draft name, last modified, completion percentage
- [ ] Resume button to continue editing
- [ ] Delete button to discard draft
- [ ] Show empty state when no drafts

## Dependencies
- P4-001 (Wizard Container)
- P4-002 (Wizard State)

## Estimated Time
2-3 hours

## Files to Create/Modify
- `frontend/src/components/Dashboard/DraftsDashboard.tsx`
- `frontend/src/components/Dashboard/DraftCard.tsx`

## Notes
- This is a key UX feature for interrupted sessions
- Consider sorting by last modified
