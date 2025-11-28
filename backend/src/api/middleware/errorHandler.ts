import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { randomUUID } from 'crypto';
import {
  DomainError,
  ValidationError,
  NotFoundError,
  EngineError,
} from '../../domain/errors/index.js';

/**
 * Standard API error response format
 */
export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    correlationId: string;
    details?: unknown;
  };
}

/**
 * Creates a standardized error response
 */
function createErrorResponse(
  code: string,
  message: string,
  correlationId: string,
  details?: unknown
): ApiErrorResponse {
  return {
    error: {
      code,
      message,
      correlationId,
      ...(details !== undefined && { details }),
    },
  };
}

/**
 * Central error handling middleware.
 *
 * Maps domain errors to appropriate HTTP status codes and
 * returns a consistent error response format.
 *
 * Must be registered LAST in the middleware chain.
 */
export const errorHandler: ErrorRequestHandler = (
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void => {
  const correlationId = (req.headers['x-correlation-id'] as string) || randomUUID();
  const isProduction = process.env.NODE_ENV === 'production';

  // Log error server-side (always include stack in logs)
  console.error(`[${correlationId}] Error:`, {
    name: err.name,
    message: err.message,
    path: req.path,
    method: req.method,
    stack: err.stack,
  });

  // Handle ValidationError (400)
  if (err instanceof ValidationError) {
    res.status(400).json(
      createErrorResponse(
        err.code,
        err.message,
        correlationId,
        err.hasFieldErrors() ? { fieldErrors: err.fieldErrors } : undefined
      )
    );
    return;
  }

  // Handle NotFoundError (404)
  if (err instanceof NotFoundError) {
    res.status(404).json(
      createErrorResponse(err.code, err.message, correlationId)
    );
    return;
  }

  // Handle EngineError (500 or 503 if retryable)
  if (err instanceof EngineError) {
    const status = err.isRetryable() ? 503 : 500;
    res.status(status).json(
      createErrorResponse(
        err.code,
        err.message,
        correlationId,
        {
          engineType: err.engineType,
          retryable: err.isRetryable(),
          ...(err.exitCode !== undefined && { exitCode: err.exitCode }),
        }
      )
    );
    return;
  }

  // Handle generic DomainError
  if (err instanceof DomainError) {
    res.status(err.httpStatus).json(
      createErrorResponse(
        err.code,
        err.message,
        correlationId,
        err.context
      )
    );
    return;
  }

  // Handle SyntaxError from JSON parsing
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json(
      createErrorResponse(
        'INVALID_JSON',
        'Invalid JSON in request body',
        correlationId
      )
    );
    return;
  }

  // Unknown error - 500 Internal Server Error
  // Don't expose internal details in production
  res.status(500).json(
    createErrorResponse(
      'INTERNAL_ERROR',
      isProduction ? 'An internal error occurred' : err.message,
      correlationId,
      isProduction ? undefined : { name: err.name }
    )
  );
};
