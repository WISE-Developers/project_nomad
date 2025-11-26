# P8-004: Map Popup for Output Preview

## Description
Create popup/modal component for previewing outputs on a map.

## Acceptance Criteria
- [ ] Create `OutputPreviewModal` component
- [ ] Embed MapBox GL instance for preview
- [ ] Display selected output layer (perimeter, probability grid)
- [ ] Zoom to output extent automatically
- [ ] Support panning/zooming within preview
- [ ] Close button to return to results list

## Dependencies
- P8-003 (Output List)
- P3-001 (MapBox Wrapper)
- P3-003 (Layer Management)

## Estimated Time
3 hours

## Files to Create/Modify
- `frontend/src/features/ModelReview/OutputPreviewModal.tsx`

## Notes
- Reuse map components from Phase 3
- Preview should be quick to load
- Consider caching rendered outputs
