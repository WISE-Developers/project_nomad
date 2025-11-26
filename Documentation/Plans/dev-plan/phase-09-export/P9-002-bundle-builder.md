# P9-002: Export Bundle Builder

## Description
Create service for building export bundles with multiple outputs.

## Acceptance Criteria
- [ ] Create `ExportBundleBuilder` class
- [ ] Add outputs to bundle by ID
- [ ] Apply format conversion if needed
- [ ] Generate bundle manifest (list of contents)
- [ ] Calculate total bundle size
- [ ] Support mixing different output types

## Dependencies
- P9-001 (Format Registry)
- P8-001 (Results Service)

## Estimated Time
3 hours

## Files to Create/Modify
- `backend/src/infrastructure/export/ExportBundleBuilder.ts`
- `backend/src/domain/entities/ExportBundle.ts`

## Notes
- Bundle is the unit of export delivery
- Manifest helps users understand contents
