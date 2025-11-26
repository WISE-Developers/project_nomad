# P9-003: ZIP Download Generation

## Description
Implement ZIP archive creation and download for export bundles.

## Acceptance Criteria
- [ ] Create `ZipGenerator` service
- [ ] Convert export bundle to ZIP archive
- [ ] Include manifest file in ZIP
- [ ] Stream ZIP to response (don't buffer in memory)
- [ ] Set appropriate Content-Disposition header
- [ ] Clean up temporary files after download

## Dependencies
- P9-002 (Bundle Builder)

## Estimated Time
2-3 hours

## Files to Create/Modify
- `backend/src/infrastructure/export/ZipGenerator.ts`
- `backend/src/api/routes/v1/exports.ts`

## Notes
- Use archiver or yazl package for ZIP creation
- Streaming is important for large exports
