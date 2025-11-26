# P2-001: Configuration TypeScript Types

## Description
Define the TypeScript types/interfaces for the configuration system, matching the JSON schema from project_plan.md.

## Acceptance Criteria
- [ ] Create `NomadConfig` root type with all configuration sections
- [ ] Create `AgencyConfig` type (id, name, branding)
- [ ] Create `DataSourceConfig` type (weather, wildfirePoints, fuelTypes)
- [ ] Create `ModelConfig` type (available engines, suppressed engines)
- [ ] Create `ExportConfig` type (allowed delivery methods)
- [ ] Create `RoleMappingConfig` type for agency role mapping
- [ ] Export all types from barrel file

## Dependencies
- None (can run parallel to Phase 1)

## Estimated Time
2 hours

## Files to Create/Modify
- `backend/src/infrastructure/config/types/NomadConfig.ts`
- `backend/src/infrastructure/config/types/AgencyConfig.ts`
- `backend/src/infrastructure/config/types/DataSourceConfig.ts`
- `backend/src/infrastructure/config/types/ModelConfig.ts`
- `backend/src/infrastructure/config/types/ExportConfig.ts`
- `backend/src/infrastructure/config/types/index.ts`

## Notes
- Reference the JSON example in project_plan.md Configuration Structure section
- Use strict types (avoid `any`)
- Consider Zod schemas for runtime validation (future enhancement)
