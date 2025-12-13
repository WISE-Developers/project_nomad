# P3-003: Auth Abstraction

**GitHub Milestone**: [P3-003: Auth Abstraction](https://github.com/WISE-Developers/project_nomad/milestone/11)

## Overview

Create an authentication abstraction layer supporting both OIDC/OAuth 2.0 and SAML 2.0 protocols. In ACN mode, agencies use their own identity providers. The abstraction ensures the Nomad codebase doesn't care which protocol the agency uses.

**Key Decision**: Protocol-based, not provider-based. We support OIDC and SAML protocols - agencies choose their provider (FusionAuth, Okta, Azure AD, etc.).

## Tasks

### P3-003-01: Auth Provider Interface

**Description**: Define the abstract interface for authentication providers.

**Acceptance Criteria**:
- [ ] Create `IAuthProvider` interface with: `login()`, `logout()`, `getUser()`, `isAuthenticated()`, `getAccessToken()`
- [ ] Create `AuthUser` type: id, email, name, roles (Nomad roles), rawRoles (agency roles)
- [ ] Create `AuthConfig` type for provider-specific configuration
- [ ] Interface supports both redirect-based and token-based auth flows
- [ ] Add `refreshToken()` method for session management

**Files to Create/Modify**:
- `backend/src/application/interfaces/IAuthProvider.ts`
- `backend/src/core/auth/types/AuthTypes.ts`
- `backend/src/core/auth/index.ts`

**Dependencies**: P3-001-03, P3-002-01

---

### P3-003-02: OIDC/OAuth 2.0 Implementation

**Description**: Implement auth provider for OIDC/OAuth 2.0 protocol.

**Acceptance Criteria**:
- [ ] Create `OIDCProvider` implementing `IAuthProvider`
- [ ] Support authorization code flow with PKCE
- [ ] Configure from `config.auth.oidc` section
- [ ] Handle token refresh automatically
- [ ] Parse ID token for user claims
- [ ] Support standard OIDC scopes (openid, profile, email)

**Files to Create/Modify**:
- `backend/src/infrastructure/auth/OIDCProvider.ts`
- `backend/src/infrastructure/auth/OIDCConfig.ts`
- `frontend/src/core/auth/providers/OIDCAuthProvider.tsx`

**Dependencies**: P3-003-01

**External Dependencies**:
- `openid-client` (Node.js)
- `oidc-client-ts` (Frontend)

---

### P3-003-03: SAML 2.0 Implementation

**Description**: Implement auth provider for SAML 2.0 protocol.

**Acceptance Criteria**:
- [ ] Create `SAMLProvider` implementing `IAuthProvider`
- [ ] Support SP-initiated SSO flow
- [ ] Configure from `config.auth.saml` section
- [ ] Parse SAML assertion for user attributes
- [ ] Handle SAML response validation (signature, conditions)
- [ ] Support single logout (SLO)

**Files to Create/Modify**:
- `backend/src/infrastructure/auth/SAMLProvider.ts`
- `backend/src/infrastructure/auth/SAMLConfig.ts`
- `backend/src/infrastructure/auth/SAMLMiddleware.ts`

**Dependencies**: P3-003-01

**External Dependencies**:
- `@node-saml/node-saml` or `passport-saml`

---

### P3-003-04: Role Mapping Service

**Description**: Map agency-specific roles to Nomad roles.

**Acceptance Criteria**:
- [ ] Create `RoleMappingService` that uses configuration
- [ ] Map agency roles (from token/assertion) to Nomad roles
- [ ] Nomad roles: Admin, FBAN, Modeler, User, Anon
- [ ] Handle unmapped roles (default to lowest privilege)
- [ ] Log role mapping for audit
- [ ] Support 1:many mapping (agency role -> multiple Nomad roles)

**Files to Create/Modify**:
- `backend/src/core/auth/RoleMappingService.ts`
- `backend/src/core/auth/types/Roles.ts`

**Dependencies**: P3-003-01, P3-002-01

---

### P3-003-05: Auth Integration Tests

**Description**: Test suite for authentication system.

**Acceptance Criteria**:
- [ ] Test: SAN mode uses file-based auth (existing)
- [ ] Test: ACN mode with OIDC - mock IdP responds correctly
- [ ] Test: ACN mode with SAML - mock IdP responds correctly
- [ ] Test: Role mapping transforms agency roles to Nomad roles
- [ ] Test: Invalid tokens rejected
- [ ] Test: Token refresh works
- [ ] Test: Frontend auth context reflects backend state

**Files to Create/Modify**:
- `backend/src/infrastructure/auth/__tests__/OIDCProvider.test.ts`
- `backend/src/infrastructure/auth/__tests__/SAMLProvider.test.ts`
- `backend/src/core/auth/__tests__/RoleMappingService.test.ts`
- `frontend/src/core/auth/__tests__/AuthContext.test.tsx`

**Dependencies**: P3-003-01 through P3-003-04

---

## Architecture Notes

```
┌─────────────────────────────────────────────────────────┐
│                   Frontend                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │              AuthContext                         │   │
│  │  - user: AuthUser | null                        │   │
│  │  - isAuthenticated: boolean                     │   │
│  │  - login(): Promise<void>                       │   │
│  │  - logout(): Promise<void>                      │   │
│  └─────────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│                    Backend                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │            IAuthProvider Interface               │   │
│  └───────────────┬─────────────────┬───────────────┘   │
│                  │                 │                    │
│         ┌────────┴────────┐ ┌──────┴───────┐          │
│         │  OIDCProvider   │ │ SAMLProvider │          │
│         └────────┬────────┘ └──────┬───────┘          │
│                  │                 │                    │
│                  ▼                 ▼                    │
│  ┌─────────────────────────────────────────────────┐   │
│  │           RoleMappingService                    │   │
│  │     agency roles → Nomad roles                  │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
          ┌─────────────────────────┐
          │   Agency IdP            │
          │   (FusionAuth, Okta,    │
          │    Azure AD, etc.)      │
          └─────────────────────────┘
```

## Configuration Example

```json
{
  "auth": {
    "provider": "oidc",
    "oidc": {
      "issuer": "https://auth.agency.gov/realms/nomad",
      "clientId": "nomad-frontend",
      "redirectUri": "https://nomad.agency.gov/callback",
      "scopes": ["openid", "profile", "email", "roles"]
    },
    "roleMapping": {
      "fire-analyst": "FBAN",
      "senior-analyst": ["FBAN", "Admin"],
      "modeler": "Modeler",
      "viewer": "User"
    }
  }
}
```

## SST Alignment

From R3-nomad-frontend.md:
> Auth Abstraction supporting OIDC/OAuth 2.0 and SAML 2.0 protocols

And from master plan Key Decision #6:
> **Protocol-Based Auth**: Support OIDC/OAuth 2.0 and SAML 2.0 - agency chooses their provider
