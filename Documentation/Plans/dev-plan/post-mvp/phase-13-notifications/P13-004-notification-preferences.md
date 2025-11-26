# P13-004: Notification Preferences UI

## Description
Create UI for users to manage their notification preferences.

## Acceptance Criteria
- [ ] Create `NotificationPreferences` component
- [ ] Toggle for enabling/disabling notifications
- [ ] Channel selection (web push, email, both)
- [ ] Event type preferences (model complete, failures, system)
- [ ] Save preferences to user profile
- [ ] Request browser notification permission

## Dependencies
- P13-002 (Web Push)
- P11-001 (User/Role system)

## Estimated Time
3 hours

## Files to Create/Modify
- `frontend/src/features/Settings/NotificationPreferences.tsx`
- `frontend/src/hooks/useNotifications.ts`

## Notes
- Browser permission prompt on first enable
- Remember permission state
