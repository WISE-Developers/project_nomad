import { Request, Response, RequestHandler } from 'express';
import { randomUUID } from 'crypto';

/**
 * 404 handler for unknown routes.
 *
 * Should be registered after all other routes but before
 * the error handler middleware.
 */
export const notFoundHandler: RequestHandler = (req: Request, res: Response): void => {
  const correlationId = (req.headers['x-correlation-id'] as string) || randomUUID();

  console.warn(`[${correlationId}] Route not found: ${req.method} ${req.path}`);

  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route not found: ${req.method} ${req.path}`,
      correlationId,
    },
  });
};
