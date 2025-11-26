# P8-005: Add to Main Map Functionality

## Description
Implement ability to add model outputs as layers on the main application map.

## Acceptance Criteria
- [ ] "Add to map" button in output list
- [ ] Add selected output as layer on main map
- [ ] Navigate to main map view after adding
- [ ] Layer appears in layer panel with output name
- [ ] Support adding multiple outputs simultaneously
- [ ] Handle outputs already added (no duplicates)

## Dependencies
- P8-003 (Output List)
- P3-003 (Layer Management)

## Estimated Time
2-3 hours

## Files to Create/Modify
- `frontend/src/features/ModelReview/useAddToMap.ts`
- `frontend/src/components/Map/LayerManager.ts` (extend)

## Notes
- This bridges Review workflow to main map
- Consider layer naming convention for model outputs
