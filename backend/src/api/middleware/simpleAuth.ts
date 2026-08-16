/**
 * Simple Auth Middleware
 *
 * Extracts username from X-Nomad-User header when auth mode is 'simple'.
 * This is a demo/SAN-mode authentication mechanism - not for production ACN deployments.
 */

import { Request, Response, NextFunction } from 'express';

/**
 * Extend Express Request to include user
 */
declare global {
  namespace Express {
    interface Request {
      /** Display identity. In oauth mode this is `name || email`. */
      user?: string;
      /**
       * The authenticated user's email, set by betterAuthSession in oauth mode.
       * The usage log is keyed on this rather than on `user`, which is mutable
       * and not unique. (#332)
       */
      userEmail?: string;
    }
  }
}

/**
 * Middleware that extracts user from X-Nomad-User header when auth mode is 'simple'.
 * Always extracts the header — the mode gating is handled by the middleware selection in index.ts.
 */
export function simpleAuthMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const userHeader = req.headers['x-nomad-user'];
  if (typeof userHeader === 'string' && userHeader.trim().length > 0) {
    req.user = userHeader.trim();
  }
  next();
}
