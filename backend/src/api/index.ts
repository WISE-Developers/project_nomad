/**
 * API Module
 *
 * Exports routers, middleware, and Swagger configuration.
 */

export { default as apiRouter } from './routes/index.js';
export { setupSwagger, swaggerSpec } from './swagger.js';
export {
  asyncHandler,
  errorHandler,
  notFoundHandler,
  requestLogger,
  simpleAuthMiddleware,
  acnAuthMiddleware,
  resolveAuthMode,
  betterAuthSessionMiddleware,
  requireRoles,
  type ApiErrorResponse,
  type AuthMode,
  type ACNContext,
  type AgencyIdentity,
  type UserIdentity,
  type NomadRole,
  VALID_ROLES,
} from './middleware/index.js';
