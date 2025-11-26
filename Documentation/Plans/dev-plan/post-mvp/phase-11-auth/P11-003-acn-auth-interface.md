# P11-003: ACN Mode - Agency Auth Integration Interface

## Description
Create interface for integrating with agency authentication systems.

## Acceptance Criteria
- [ ] Create `IAuthProvider` interface
- [ ] Support OAuth2/OIDC integration points
- [ ] Support SAML integration points
- [ ] Create agency role mapping from configuration
- [ ] Handle token validation from external IdP

## Dependencies
- P11-001 (Role Definitions)
- P2-001 (Configuration Types - role mapping)

## Estimated Time
3-4 hours

## Files to Create/Modify
- `backend/src/application/interfaces/IAuthProvider.ts`
- `backend/src/infrastructure/auth/OAuthProvider.ts`
- `backend/src/infrastructure/auth/SAMLProvider.ts`

## Notes
- ACN mode uses agency's existing auth
- Role mapping converts agency roles to Nomad roles
- Each agency may have different IdP
