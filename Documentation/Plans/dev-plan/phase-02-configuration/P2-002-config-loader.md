# P2-002: Configuration Loader Service

## Description
Implement the service that loads configuration from JSON files with fallback to defaults.

## Acceptance Criteria
- [ ] Create `ConfigurationLoader` class implementing `IConfigurationService`
- [ ] Load from `/configuration/{agency_id}/config.json` when agency ID set
- [ ] Fallback to `/configuration/generic/config.json`
- [ ] Merge agency config with default config (agency overrides defaults)
- [ ] Handle missing files gracefully with clear error messages
- [ ] Cache loaded configuration (singleton pattern)

## Dependencies
- P1-003 (Application Interfaces - IConfigurationService)
- P2-001 (Configuration Types)

## Estimated Time
3 hours

## Files to Create/Modify
- `backend/src/infrastructure/config/ConfigurationLoader.ts`
- `backend/src/infrastructure/config/index.ts`

## Notes
- Use `fs.readFileSync` for simplicity (config loaded once at startup)
- Consider async loading for large configs
- Log which config file was loaded
