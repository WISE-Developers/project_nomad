/**
 * Simple Auth Middleware
 *
 * Extracts username from X-Nomad-User header when auth mode is 'simple'.
 * This is a demo/SAN-mode authentication mechanism - not for production ACN deployments.
 */

import { Request, Response, NextFunction } from 'express';

/**
 * Extend Express Request to include user.
 *
 * `namespace` is not a style choice here: augmenting Express's Request is only
 * possible by merging into the global Express namespace it declares. There is
 * no module-syntax equivalent, so no-namespace cannot be satisfied without
 * giving up the augmentation entirely. Accepted deliberately (#386).
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
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
