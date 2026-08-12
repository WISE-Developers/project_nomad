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
import { SessionUsageTracker } from '../../application/usage/sessionTracker.js';
import { createUsageEvent } from '../../application/usage/usageEvent.js';
import { getUsageLogger } from '../../infrastructure/usage/index.js';
import { EnvironmentService } from '../../infrastructure/config/EnvironmentService.js';

/**
 * Process-local memory of which sessions have already been counted as logins.
 *
 * Better Auth owns sign-in; its database hooks expose only a userId, while
 * every other event in the usage log is keyed on email. Logins are therefore
 * inferred here, where the email is already resolved. Exported so the sign-out
 * path can resolve the same email for the same session.
 */
export const sessionUsageTracker = new SessionUsageTracker();

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
      // Stable identity for the usage log, kept separate from the display value.
      req.userEmail = session.user.email ?? undefined;

      // Usage log identity is the EMAIL, never the display name: names are
      // mutable and not unique, and every other event is keyed on email.
      await recordLoginIfNew(session);
    }
  } catch {
    // Session resolution failed — not blocking, just no user
  }

  next();
}

/**
 * Emits session.login the first time a session is seen.
 *
 * Never throws and never blocks the request: authentication does not depend on
 * the usage log being writable.
 */
async function recordLoginIfNew(session: {
  user: { email?: string | null };
  session?: { id?: string; token?: string };
}): Promise<void> {
  try {
    const email = session.user.email;
    const sessionId = session.session?.id ?? session.session?.token;
    if (!email || !sessionId) return;

    const sighting = sessionUsageTracker.noteSeen(sessionId, email);
    if (!sighting.isNew) return;

    await getUsageLogger().record(
      createUsageEvent({
        type: 'session.login',
        actor: sighting.actor,
        zone: EnvironmentService.getInstance().getHomeTimezone(),
        now: new Date(),
        detail: {
          success: true,
          // This is observed from a request, not from the sign-in itself. After
          // a restart every active session is sighted afresh and reported here
          // again, so this must not be read as a clean sign-in count.
          inferred_from_first_sighting: true,
        },
      })
    );
  } catch {
    // Usage logging must never break authentication.
  }
}
