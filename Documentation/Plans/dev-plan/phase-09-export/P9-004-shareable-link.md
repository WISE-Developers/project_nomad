# P9-004: Shareable Link Generation

## Description
Create functionality for generating shareable links to exports.

## Acceptance Criteria
- [ ] Generate unique, secure export link tokens
- [ ] Store export configuration with token
- [ ] Create download endpoint that accepts token
- [ ] Set expiration time on links (configurable)
- [ ] Track download count
- [ ] Invalidate link after max downloads or expiration

## Dependencies
- P9-003 (ZIP Download)

## Estimated Time
3 hours

## Files to Create/Modify
- `backend/src/infrastructure/export/ShareableLinkService.ts`
- `backend/src/domain/entities/ShareableLink.ts`
- `backend/src/api/routes/v1/exports.ts` (add share endpoint)

## Notes
- Tokens should be cryptographically random
- Consider URL shortening for cleaner links
