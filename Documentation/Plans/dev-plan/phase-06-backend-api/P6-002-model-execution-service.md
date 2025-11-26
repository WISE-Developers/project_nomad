# P6-002: Model Execution Service

## Description
Create the service that spawns shell processes for model execution.

## Acceptance Criteria
- [ ] Create `ModelExecutionService` class
- [ ] Method to spawn model process (child_process)
- [ ] Capture stdout/stderr for logging
- [ ] Handle process exit codes
- [ ] Timeout handling for long-running models
- [ ] Support cancellation of running models

## Dependencies
- P1-003 (IFireModelingEngine interface)

## Estimated Time
3-4 hours

## Files to Create/Modify
- `backend/src/infrastructure/services/ModelExecutionService.ts`

## Notes
- Uses child_process.spawn for shell execution
- Actual engine commands defined in Phase 7 (FireSTARR)
- Consider process isolation for security
