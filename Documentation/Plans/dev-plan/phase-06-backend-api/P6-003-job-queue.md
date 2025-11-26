# P6-003: Job Queue and Status Tracking

## Description
Implement a job queue system for managing model execution requests and tracking status.

## Acceptance Criteria
- [ ] Create `JobQueue` service (in-memory for MVP, Redis later)
- [ ] Job states: pending, running, completed, failed, cancelled
- [ ] Create job on model execution request
- [ ] Update job status during execution
- [ ] Store job results/outputs reference
- [ ] API endpoint to get job status by ID

## Dependencies
- P6-002 (Model Execution Service)

## Estimated Time
3-4 hours

## Files to Create/Modify
- `backend/src/infrastructure/services/JobQueue.ts`
- `backend/src/domain/entities/Job.ts`
- `backend/src/api/routes/v1/jobs.ts` (add status endpoint)

## Notes
- In-memory queue is fine for MVP (single server)
- Consider Bull/BullMQ for production queue
- Jobs persist basic info even after completion
