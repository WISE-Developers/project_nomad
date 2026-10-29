/**
 * Warn when a request names a user Nomad cannot honour (#488).
 *
 * The defect this closes: a caller sends an identity header, the active mode cannot read
 * that header, and Nomad answers success while storing `userId: null`. Nothing in the
 * response or the log says the identity was discarded, so the deployment looks healthy
 * while every model records nobody. **A silent default is a lie** — the acceptance is
 * fine, the silence is not.
 *
 * This is deliberately a WARNING and not a rejection. Rejecting would be the stricter
 * fail-fast reading, but it would break any caller that sends an identity header
 * harmlessly against a mode that ignores it, and the defect being fixed is the silence
 * rather than the acceptance. The remedy is one `logger.warn` to change if that call goes
 * the other way.
 *
 * WHY THIS IS ITS OWN MIDDLEWARE, mounted unconditionally. `acnAuth` already contains
 * `if (process.env.NOMAD_DEPLOYMENT_MODE !== 'ACN') return next()`, which looks like the
 * natural home — but `index.ts` only mounts `acnAuth` when the mode is ALREADY `ACN`, so
 * that branch is unreachable in every SAN deployment. A warning placed there would be a
 * guard that never fires in precisely the case it exists for.
 *
 * The header is read but never acted upon here: this middleware sets nothing on the
 * request and changes no behaviour. Identity resolution stays entirely in `simpleAuth`,
 * `acnAuth` and `betterAuthSession`.
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../../infrastructure/logging/index.js';
import { resolveAuthMode } from './authMode.js';

/** Canonical spellings, for a warning an operator can grep for. */
const ACN_USER_HEADER = 'X-Nomad-User-Id';
const SIMPLE_USER_HEADER = 'X-Nomad-User';

/**
 * Which identity header, if any, the active mode can actually read.
 *
 * `oauth` and `none` can read none: oauth resolves identity from the Better Auth session
 * (`betterAuthSession` sets `req.userEmail`), and `none` mounts no auth middleware at all.
 * So a proxy cannot carry a user into either by header, and saying so is the point.
 */
function honourableHeader(mode: string): string | undefined {
  if (mode === 'ACN') return ACN_USER_HEADER;
  if (mode === 'simple') return SIMPLE_USER_HEADER;
  return undefined;
}

/** The active mode, named the way the warning should name it. */
function activeMode(): string {
  return process.env.NOMAD_DEPLOYMENT_MODE === 'ACN' ? 'ACN' : resolveAuthMode();
}

export function unhonouredIdentityMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const mode = activeMode();
  const honoured = honourableHeader(mode);

  // Both members of the class, so this is not a fix applied to one branch: ACN identity is
  // unreadable in every SAN mode, and the simple header is unreadable in ACN, oauth and
  // none.
  const present: string[] = [];
  if (req.headers['x-nomad-user-id'] && honoured !== ACN_USER_HEADER) {
    present.push(ACN_USER_HEADER);
  }
  if (req.headers['x-nomad-user'] && honoured !== SIMPLE_USER_HEADER) {
    present.push(SIMPLE_USER_HEADER);
  }

  if (present.length > 0) {
    const expectation = honoured
      ? `this mode reads ${honoured}`
      : `this mode reads no identity header — identity comes from the session (oauth) or is absent (none)`;

    logger.warn(
      `Identity header ignored: ${present.join(', ')} sent but the active mode is ` +
        `${mode}, where ${expectation}. The author will be recorded as null. ` +
        `${req.method} ${req.originalUrl}`,
      'Auth'
    );
  }

  next();
}

export default unhonouredIdentityMiddleware;
