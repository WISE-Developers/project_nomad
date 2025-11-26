# P10-004: WISE Docker/SSH Integration

## Description
Create integration layer for running WISE via Docker or SSH tunnel to remote server.

## Acceptance Criteria
- [ ] Support local Docker execution
- [ ] Support SSH tunnel to remote WISE server
- [ ] Handle ARM64 to x86_64 requirements (Mac M1/M2)
- [ ] Configure job directory structure
- [ ] Monitor execution progress

## Dependencies
- P10-001 (WISE Adapter)

## Estimated Time
4 hours

## Files to Create/Modify
- `backend/src/infrastructure/engines/wise/WISEExecutor.ts`
- `backend/src/infrastructure/engines/wise/SSHTunnel.ts`

## Notes
- Reference WiseGuy docker/ directory for orchestration patterns
- WISE may require x86_64 architecture
- SSH tunnel enables remote execution from ARM64 machines
