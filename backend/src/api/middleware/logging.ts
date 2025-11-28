import { Request, Response, NextFunction, RequestHandler } from 'express';
import { randomUUID } from 'crypto';

/**
 * Simple request logging middleware.
 *
 * Logs request start and completion with timing.
 * Adds correlation ID to request headers if not present.
 */
export const requestLogger: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const startTime = Date.now();

  // Ensure correlation ID exists
  if (!req.headers['x-correlation-id']) {
    req.headers['x-correlation-id'] = randomUUID();
  }
  const correlationId = req.headers['x-correlation-id'];

  // Log request start
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${correlationId}] --> ${req.method} ${req.path}`);

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const finishTimestamp = new Date().toISOString();
    console.log(
      `[${finishTimestamp}] [${correlationId}] <-- ${req.method} ${req.path} ${res.statusCode} (${duration}ms)`
    );
  });

  next();
};
