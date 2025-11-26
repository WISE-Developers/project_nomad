# P11-005: Protected Route Middleware

## Description
Create backend middleware for protecting API routes by role.

## Acceptance Criteria
- [ ] Create `requireAuth` middleware (any authenticated user)
- [ ] Create `requireRole` middleware (specific role required)
- [ ] Create `requirePermission` middleware (specific permission)
- [ ] Return 401 for unauthenticated, 403 for unauthorized
- [ ] Log authentication/authorization failures

## Dependencies
- P11-001 (Role Definitions)
- P11-002 or P11-003 (Auth Provider)

## Estimated Time
2-3 hours

## Files to Create/Modify
- `backend/src/api/middleware/requireAuth.ts`
- `backend/src/api/middleware/requireRole.ts`
- `backend/src/api/middleware/requirePermission.ts`

## Notes
- Middleware chain: authenticate -> authorize -> route handler
- Include rate limiting for failed auth attempts
