# P11-001: Role Definitions and Permission Matrix

## Description
Define user roles and their permissions for the Nomad system.

## Acceptance Criteria
- [ ] Create `Role` enum: Admin, FBAN, Modeler, User, Anonymous
- [ ] Create `Permission` enum for all system actions
- [ ] Create permission matrix mapping roles to permissions
- [ ] Create `RoleService` to check permissions
- [ ] Document each role's capabilities

## Dependencies
- None

## Estimated Time
2-3 hours

## Files to Create/Modify
- `backend/src/domain/auth/Role.ts`
- `backend/src/domain/auth/Permission.ts`
- `backend/src/domain/auth/PermissionMatrix.ts`
- `backend/src/application/services/RoleService.ts`

## Notes
- Roles from project_plan.md: Admin, FBAN, Modeler, User, Anon User
- FBAN = Fire Behavior Analyst (full access)
- Permissions control UI feature visibility and API access
