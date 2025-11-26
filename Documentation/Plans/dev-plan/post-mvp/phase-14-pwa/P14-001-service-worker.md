# P14-001: Service Worker Setup

## Description
Implement service worker for PWA functionality using Vite PWA plugin.

## Acceptance Criteria
- [ ] Install and configure vite-plugin-pwa
- [ ] Create service worker with caching strategy
- [ ] Cache static assets for offline access
- [ ] Cache API responses selectively
- [ ] Handle service worker updates gracefully

## Dependencies
- Frontend setup (Phase 0)

## Estimated Time
3-4 hours

## Files to Create/Modify
- `frontend/vite.config.ts` (add PWA plugin)
- `frontend/src/sw.ts` (custom service worker)
- `frontend/src/registerSW.ts`

## Notes
- Use Workbox strategies via Vite PWA
- Consider stale-while-revalidate for API calls
- Test service worker in production mode
