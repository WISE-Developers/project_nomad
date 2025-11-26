# P7-004: Docker Exec Wrapper

## Description
Create wrapper for executing FireSTARR commands in Docker container.

## Acceptance Criteria
- [ ] Create `DockerExecutor` service for running container commands
- [ ] Build docker compose run command with correct arguments
- [ ] Mount volumes correctly (dataset, sims, config)
- [ ] Capture container stdout/stderr
- [ ] Handle container exit codes
- [ ] Support environment variable passing

## Dependencies
- P7-001 (FireSTARR Adapter)
- docker-compose.yaml configuration

## Estimated Time
3 hours

## Files to Create/Modify
- `backend/src/infrastructure/engines/DockerExecutor.ts`

## Notes
- Reference launch_nomad.sh for correct docker compose patterns
- Uses docker compose run --rm for one-off executions
- Command format: /appl/firestarr/firestarr [args...]
