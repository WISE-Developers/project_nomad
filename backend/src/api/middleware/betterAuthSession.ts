/**
 * Better Auth Session Middleware
 *
 * Reads the Better Auth session cookie and populates req.user
 * with the authenticated user's name or email.
 * Maintains the same req.user contract as simpleAuth and acnAuth.
 */

import { Request, Response, NextFunction } from 'express';
import { getBetterAuth } from '../../infrastructure/auth/index.js';
import { fromNodeHeaders } from 'better-auth/node';

/**
 * Middleware that resolves Better Auth session to req.user.
 * If no valid session exists, passes through without blocking.
 */
export async function betterAuthSessionMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const auth = getBetterAuth();
    if (!auth) {
      next();
      return;
    }

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (session?.user) {
      // Use display name, fall back to email
      req.user = session.user.name || session.user.email;
    }
  } catch {
    // Session resolution failed — not blocking, just no user
  }

  next();
}
