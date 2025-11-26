# P11-002: SAN Mode - Simple File-Based Auth

## Description
Implement simple file-based authentication for Stand Alone Nomad deployments.

## Acceptance Criteria
- [ ] Create users.json file format for user storage
- [ ] Implement password hashing (bcrypt)
- [ ] Create login/logout API endpoints
- [ ] Implement JWT token generation
- [ ] Create session management
- [ ] Admin interface for user management

## Dependencies
- P11-001 (Role Definitions)

## Estimated Time
4-5 hours

## Files to Create/Modify
- `backend/src/infrastructure/auth/FileAuthProvider.ts`
- `backend/src/api/routes/v1/auth.ts`
- `backend/src/api/middleware/authMiddleware.ts`
- `configuration/users.json.example`

## Notes
- SAN mode needs simple, self-contained auth
- No external auth server dependencies
- Consider first-run setup for admin user
