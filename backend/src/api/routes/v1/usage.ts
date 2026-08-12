import { Router, type Request, type Response, type NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import type { IUsageQuery } from '../../../application/interfaces/IUsageQuery.js';
import type { IUsageLogger } from '../../../application/interfaces/IUsageLogger.js';
import type { UsageEventType } from '../../../domain/value-objects/UsageEvent.js';
import { createUsageEvent } from '../../../application/usage/usageEvent.js';
import { actorFromRequest } from '../../../infrastructure/usage/requestUsage.js';
import { resolveAuthMode } from '../../middleware/authMode.js';
import type { AuthMode } from '../../../domain/value-objects/UsageEvent.js';

/** Shortest token worth having. Below this, guessing is cheap. */
const MIN_TOKEN_LENGTH = 32;
/** Hard ceiling on a single response, so no call can drain the whole log. */
const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 100;

/**
 * Whether the usage endpoint should be registered at all.
 *
 * Fail closed: with no token configured the route is never mounted, so there is
 * no handler for a middleware-ordering mistake to expose. An unregistered route
 * cannot be reached by accident.
 */
export function isUsageEndpointEnabled(): boolean {
  return Boolean(process.env.NOMAD_USAGE_API_TOKEN?.trim());
}

/**
 * Reads and validates the endpoint token.
 *
 * @throws Error if absent or too short. There is no default: a default token is
 *         a published password.
 */
export function resolveUsageToken(): string {
  const token = process.env.NOMAD_USAGE_API_TOKEN?.trim();
  if (!token) {
    throw new Error(
      'NOMAD_USAGE_API_TOKEN is not set. The usage endpoint requires an explicit token.'
    );
  }
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `NOMAD_USAGE_API_TOKEN is ${token.length} characters; at least ${MIN_TOKEN_LENGTH} are required.`
    );
  }
  return token;
}

/** Constant-time comparison, length-independent. */
function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  // Compare fixed-size digests of equal length instead.
  if (a.length !== b.length) {
    // Still do a comparison so the work done does not depend on the guess.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export interface UsageRouterDeps {
  query: IUsageQuery;
  usageLogger: IUsageLogger;
  token: string;
  homeTimezone: string;
  authMode?: AuthMode;
}

/**
 * GET /usage — query the usage log.
 *
 * The log holds identities, timestamps and activity patterns, which is a
 * personnel-shaped record. Access is by a dedicated bearer token rather than a
 * user role: there is no role concept outside ACN, and in simple mode the user
 * header is self-asserted, so "admin only" would be theatre.
 */
export function usageRouter(deps: UsageRouterDeps): Router {
  const router = Router();

  /** Records the read attempt itself. Never throws. */
  const recordRead = async (req: Request, authorised: boolean, returned?: number) => {
    try {
      const authMode = deps.authMode ?? (resolveAuthMode() as AuthMode);
      await deps.usageLogger.record(
        createUsageEvent({
          type: 'usage.read',
          actor: actorFromRequest(req, authMode),
          zone: deps.homeTimezone,
          now: new Date(),
          detail: {
            authorised,
            // Deliberately never the presented token, not even truncated: this
            // log is exactly what an attacker would read next.
            returned: returned ?? 0,
            remote: req.ip ?? null,
          },
        })
      );
    } catch {
      // Reading the log must not fail because writing to it did.
    }
  };

  const requireToken = async (req: Request, res: Response, next: NextFunction) => {
    const header = req.header('authorization') ?? '';
    const [scheme, presented] = header.split(' ');

    if (scheme !== 'Bearer' || !presented || !tokenMatches(presented, deps.token)) {
      await recordRead(req, false);
      // One shape for every rejection: absent, malformed and wrong must be
      // indistinguishable, or the response becomes an oracle.
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }

    next();
  };

  router.get('/usage', requireToken, async (req: Request, res: Response) => {
    const rawLimit = req.query.limit;
    let limit = DEFAULT_LIMIT;

    if (rawLimit !== undefined) {
      const parsed = Number(rawLimit);
      if (!Number.isInteger(parsed) || parsed < 1) {
        // Reject rather than silently substituting the default: a caller who
        // asked for something impossible should be told, not quietly answered.
        res.status(400).json({
          error: 'INVALID_LIMIT',
          message: 'limit must be a positive integer',
        });
        return;
      }
      limit = Math.min(parsed, MAX_LIMIT);
    }

    const types = typeof req.query.type === 'string'
      ? (req.query.type.split(',') as UsageEventType[])
      : undefined;
    const since = typeof req.query.since === 'string' ? req.query.since : undefined;

    const result = await deps.query.query({ limit, since, types });

    await recordRead(req, true, result.events.length);

    res.json({
      events: result.events,
      returned: result.events.length,
      total: result.total,
      limit,
      // Say so explicitly rather than letting a caller assume completeness.
      truncated: result.total > result.events.length,
    });
  });

  return router;
}
