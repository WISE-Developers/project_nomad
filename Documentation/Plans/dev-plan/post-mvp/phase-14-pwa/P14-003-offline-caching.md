# P14-003: Offline Caching Strategy

## Description
Implement comprehensive offline caching for viewing previously loaded data.

## Acceptance Criteria
- [ ] Cache completed model results for offline viewing
- [ ] Cache map tiles for last viewed area
- [ ] Show clear offline indicator in UI
- [ ] Handle offline-to-online transition
- [ ] Clear old cache to manage storage

## Dependencies
- P14-001 (Service Worker)

## Estimated Time
3-4 hours

## Files to Create/Modify
- `frontend/src/sw.ts` (extend caching logic)
- `frontend/src/components/OfflineIndicator.tsx`
- `frontend/src/hooks/useOffline.ts`

## Notes
- Full offline modeling is future enhancement
- Focus on viewing cached results offline
- Respect storage quotas
