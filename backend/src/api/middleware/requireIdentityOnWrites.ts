/**
 * Requires a resolved identity before a mutating request reaches a route (#507).
 *
 * The defect this closes: `DELETE /models/:id` had an ownership guard that only
 * fired for identified callers — `resolveUserIdCandidates` returns `[]` when
 * nothing identifies the caller, so the comparison was false and the delete
 * proceeded. Dropping one header was enough to delete another user's model.
 *
 * Mounted ONCE on the API, not per route, deliberately. There are 18 mutating
 * routes across ten files; a decision applied by editing each one is a decision
 * that a nineteenth route silently opts out of.
 *
 * Per auth mode:
 *
 *   none    open. That is what the mode means, and a standalone single-user
 *           deployment has no identity to require. Changing this would change
 *           the mode, not fix a bug.
 *   simple  identity required. **This is attribution, not authentication** —
 *           `x-nomad-user` is supplied by the client, so this raises the bar
 *           from nothing to a header the caller sets themselves. Worth doing,
 *           and worth not overstating: it stops an accidental or careless
 *           cross-user delete, not a deliberate one.
 *   oauth   session required. This one is real authentication.
 *
 * ACN is not decided here. `acnAuthMiddleware` already rejects with 401/403 and
 * is mounted app-wide when the deployment mode is ACN, so by the time a request
 * reaches this gate it has already been accepted. Deciding it again here would
 * put the same question in two places.
 *
 * Reads are never gated: #489 established that an anonymous caller may list
 * models, and gating reads here would quietly revoke that.
 */
import type { Request, Response, NextFunction } from 'express';
import { resolveAuthMode } from './authMode.js';
import { resolveUserIdCandidates } from './resolveUserId.js';

/**
 * Methods treated as mutating. `HEAD` and `OPTIONS` are reads; `OPTIONS` in
 * particular must stay open or CORS preflight fails before the real request.
 */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function requireIdentityOnWrites(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }

  // ACN decides this upstream. See the note above.
  if (process.env.NOMAD_DEPLOYMENT_MODE === 'ACN') {
    next();
    return;
  }

  const mode = resolveAuthMode();
  if (mode === 'none') {
    next();
    return;
  }

  if (resolveUserIdCandidates(req).length > 0) {
    next();
    return;
  }

  // Shaped like acnAuth's refusal, which is the only other auth refusal in the
  // codebase, and naming the remedy for THIS mode rather than a generic 401 —
  // setting a header and signing in are different actions.
  res.status(401).json({
    error: 'Unauthorized',
    message:
      mode === 'oauth'
        ? 'This request modifies data and requires an authenticated session. Sign in and retry.'
        : 'This request modifies data and requires an identity. Send the x-nomad-user header.',
  });
}
