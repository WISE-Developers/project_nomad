# P6-005: Error Handling Middleware

## Description
Create centralized error handling middleware for consistent API error responses.

## Acceptance Criteria
- [ ] Create error handling middleware function
- [ ] Map domain errors to HTTP status codes
- [ ] Return consistent error response format: { error: { code, message, details } }
- [ ] Log errors with stack traces (server-side only)
- [ ] Handle async errors (wrap async route handlers)
- [ ] 404 handler for unknown routes

## Dependencies
- P1-004 (Domain Errors)
- P6-001 (API Router)

## Estimated Time
2 hours

## Files to Create/Modify
- `backend/src/api/middleware/errorHandler.ts`
- `backend/src/api/middleware/asyncHandler.ts`
- `backend/src/api/middleware/notFound.ts`

## Notes
- Never expose stack traces to clients in production
- Include correlation ID for debugging
