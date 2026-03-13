/**
 * API Middleware
 *
 * Express middleware for request processing, error handling, and logging.
 */

export { asyncHandler } from './asyncHandler.js';
export { errorHandler, type ApiErrorResponse } from './errorHandler.js';
export { notFoundHandler } from './notFound.js';
export { requestLogger } from './logging.js';
export { simpleAuthMiddleware } from './simpleAuth.js';
export { resolveAuthMode, type AuthMode } from './authMode.js';
export { betterAuthSessionMiddleware } from './betterAuthSession.js';
export { resolveUserId } from './resolveUserId.js';
export {
  acnAuthMiddleware,
  requireRoles,
  type ACNContext,
  type AgencyIdentity,
  type UserIdentity,
  type NomadRole,
  VALID_ROLES,
} from './acnAuth.js';
