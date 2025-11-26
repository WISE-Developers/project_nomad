# P2-003: Environment Variable Handling

## Description
Set up environment variable handling for deployment mode and agency selection.

## Acceptance Criteria
- [ ] Create `EnvConfig` type for environment variables
- [ ] Read `NOMAD_DEPLOYMENT_MODE` (default: "SAN")
- [ ] Read `NOMAD_AGENCY_ID` (optional, used in ACN mode)
- [ ] Validate deployment mode is "SAN" or "ACN"
- [ ] Create helper function `getEnvConfig()` to access values
- [ ] Update backend to use dotenv for .env file loading

## Dependencies
- P2-001 (Configuration Types)

## Estimated Time
1-2 hours

## Files to Create/Modify
- `backend/src/infrastructure/config/EnvConfig.ts`
- `backend/.env.example` (add new variables)
- `backend/src/index.ts` (ensure dotenv loaded early)

## Notes
- Environment variables override JSON config for certain values
- Keep sensitive values (API keys) in env, not JSON config
