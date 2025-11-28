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
  type ApiErrorResponse,
} from './middleware/index.js';
