# P11-004: Role-Based UI Feature Toggling

## Description
Implement frontend feature toggling based on user role.

## Acceptance Criteria
- [ ] Create `useAuth` hook for auth state
- [ ] Create `usePermission` hook for checking permissions
- [ ] Create `RequirePermission` wrapper component
- [ ] Hide/disable UI elements based on role
- [ ] Show appropriate messaging for denied features

## Dependencies
- P11-001 (Role Definitions)
- P11-002 or P11-003 (Auth Provider)

## Estimated Time
3 hours

## Files to Create/Modify
- `frontend/src/hooks/useAuth.ts`
- `frontend/src/hooks/usePermission.ts`
- `frontend/src/components/Auth/RequirePermission.tsx`
- `frontend/src/components/Auth/AuthContext.tsx`

## Notes
- UI toggles for visual, not security (API still validates)
- Anonymous users see read-only views
