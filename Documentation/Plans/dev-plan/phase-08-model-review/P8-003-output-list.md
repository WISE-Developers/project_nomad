# P8-003: Output List with View/Export Actions

## Description
Create the list component showing available model outputs with action buttons.

## Acceptance Criteria
- [ ] Create `OutputList` component
- [ ] Display each output with name, type, size
- [ ] Eye icon button to view output
- [ ] Download icon button to export single file
- [ ] Checkbox to select for batch export
- [ ] Group outputs by type (perimeters, grids, etc.)

## Dependencies
- P8-001 (Results Service)
- P8-002 (Results Summary)

## Estimated Time
2-3 hours

## Files to Create/Modify
- `frontend/src/features/ModelReview/OutputList.tsx`
- `frontend/src/features/ModelReview/OutputItem.tsx`

## Notes
- Actions trigger view popup or export workflow
- Consider lazy loading for large output lists
