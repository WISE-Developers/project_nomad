# P13-005: Notification Subscription Management

## Description
Create backend system for managing notification subscriptions.

## Acceptance Criteria
- [ ] Store push subscriptions per user
- [ ] Store email preferences per user
- [ ] API endpoints for subscribe/unsubscribe
- [ ] Clean up expired subscriptions
- [ ] Handle multiple devices per user

## Dependencies
- P13-002 (Web Push)
- P13-001 (Notification Interface)

## Estimated Time
2-3 hours

## Files to Create/Modify
- `backend/src/infrastructure/notifications/SubscriptionManager.ts`
- `backend/src/api/routes/v1/notifications.ts` (extend)

## Notes
- Users may have multiple devices
- Subscriptions can expire or be revoked
