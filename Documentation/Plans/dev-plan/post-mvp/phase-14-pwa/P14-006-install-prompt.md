# P14-006: Home Screen Installation Prompt

## Description
Implement custom install prompt for adding app to home screen.

## Acceptance Criteria
- [ ] Detect PWA install availability
- [ ] Show custom install banner/prompt
- [ ] Remember dismissal preference
- [ ] Track installation events
- [ ] Handle iOS add-to-home-screen instructions

## Dependencies
- P14-001 (Service Worker)
- P14-002 (App Manifest)

## Estimated Time
2-3 hours

## Files to Create/Modify
- `frontend/src/components/InstallPrompt.tsx`
- `frontend/src/hooks/useInstallPrompt.ts`

## Notes
- iOS requires manual add-to-home-screen
- Show different instructions per platform
