/**
 * MCP authentication — the key guard and the mount chain.
 *
 * MCP is an administrative surface: it exists so that an operator who controls an
 * instance can drive it deliberately. It is not a public API, and it is configured
 * explicitly or not present at all.
 *
 * TWO VALUES, TWO DIFFERENT JOBS.
 *
 *   `NOMAD_MCP_AUTH_KEY`  authorises the caller.
 *   `NOMAD_MCP_IDENTITY`  attributes what the caller creates.
 *
 * Both are required together. The key authorises a request; the identity decides what
 * the resulting record says. Those are independent concerns, so a configuration
 * carrying one and not the other is incomplete, and an incomplete configuration stops
 * the process rather than running in a shape nobody chose.
 *
 * MOUNTING IS A CHAIN, NOT AN ORDER EACH CALL SITE REMEMBERS.
 *
 * `mountMcpChain` is the only supported way to mount MCP. The key is checked first and
 * identity resolution runs behind it, so the ordering is a property of the code rather
 * than something a second call site has to reproduce. Refusals are uniform: one status,
 * one fixed body, whatever the cause.
 *
 * ONE KEY MEANS ONE PRINCIPAL. Every record carries the configured identity regardless
 * of who presented the key. That is a property of the design and the reason the surface
 * is scoped to a single operator on an instance they control.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Application, Express, Request, RequestHandler, Response, NextFunction } from 'express';
import { mountMcpServer } from './index.js';
import type { McpToolContext } from './tools/context.js';

/**
 * The key travels in this header and nowhere else.
 *
 * Headers are not recorded by `requestLogger` (`api/middleware/logging.ts`), which logs
 * method, path, status, duration and correlation id. A key presented as a query
 * parameter is treated as absent rather than accepted, because query strings are
 * retained by intermediaries, browser history and bug reports.
 */
export const MCP_KEY_HEADER = 'x-nomad-mcp-key';

/** Minimum key length. The floor, not a recommendation — generate 48+ from a CSPRNG. */
const MIN_KEY_LENGTH = 32;

export interface McpConfig {
  readonly authKey: string;
  readonly identity: string;
}

/**
 * Why a request was refused, for the server-side record only.
 *
 * Recorded separately because the causes call for different operator responses: no key
 * presented usually means a misconfigured client, where the other two do not.
 */
export type McpRefusalReason = 'missing-key' | 'invalid-key' | 'rate-limited';

/**
 * Failed attempts tolerated before the endpoint stops answering.
 *
 * Low on purpose, and safe to keep low: a correct key is pasted from configuration
 * rather than typed, and a success clears the count, so ordinary operation does not
 * approach the threshold.
 */
export const MCP_MAX_FAILURES = 5;

/** How long a lockout lasts, measured from the failure that triggered it. */
export const MCP_LOCKOUT_MS = 5 * 60 * 1000;

export interface McpChainOptions {
  /** `null` means do not mount at all — the route must be absent, not present-and-open. */
  readonly config: McpConfig | null;
  readonly path?: string;
  /** Runs only after the guard has passed. Never reached by a refused request. */
  readonly identityMiddleware?: RequestHandler;
  /** Called on a refusal. MUST NOT be able to change the answer the refusal gets. */
  readonly onRefusal?: (reason: McpRefusalReason, req: Request) => void;
  /**
   * Identity everything MCP creates is attributed to, already resolved.
   *
   * Takes the RESOLVED value rather than `config.identity` so that the account check
   * cannot be skipped by mounting: resolution is async and startup-time, and a mount
   * that accepted the raw string would let a caller bypass it by passing the config
   * straight through.
   */
  readonly toolContext?: McpToolContext;
  /**
   * Clock for the rate limiter. Injected so a test can cross a window boundary
   * without sleeping and without replacing the global clock, which would change the
   * thing being measured rather than observing it.
   */
  readonly now?: () => number;
}

/**
 * Reads MCP credentials from the environment, failing closed on anything partial.
 *
 * @returns the config when both values are present and usable, or `null` when
 *          NEITHER is set — which means "MCP is not configured", and the caller must
 *          respond by mounting nothing.
 * @throws  when exactly one of the two is set, or the key is unusably short. A
 *          half-configuration is a mistake someone made, and the only safe reading of
 *          a mistake is to stop.
 */
export function resolveMcpConfig(env: Record<string, string | undefined>): McpConfig | null {
  const authKey = env.NOMAD_MCP_AUTH_KEY?.trim() ?? '';
  const identity = env.NOMAD_MCP_IDENTITY?.trim() ?? '';

  if (!authKey && !identity) return null;

  if (!authKey) {
    throw new Error(
      'MCP is partially configured: NOMAD_MCP_AUTH_KEY is not set while ' +
        'NOMAD_MCP_IDENTITY is. Set both, or neither.',
    );
  }

  if (!identity) {
    throw new Error(
      'MCP is partially configured: NOMAD_MCP_IDENTITY is not set while ' +
        'NOMAD_MCP_AUTH_KEY is. Set both or neither — MCP will not create ' +
        'records that belong to nobody.',
    );
  }

  if (authKey.length < MIN_KEY_LENGTH) {
    throw new Error(
      `NOMAD_MCP_AUTH_KEY is ${authKey.length} characters, which is below the ` +
        `${MIN_KEY_LENGTH}-character floor. Generate one from a CSPRNG.`,
    );
  }

  return { authKey, identity };
}

/**
 * Constant-time comparison of two secrets.
 *
 * `timingSafeEqual` requires equal-length buffers. Hashing both sides first makes them
 * the same size for any input, so the comparison is uniform and needs no length
 * handling of its own.
 */
function secretsMatch(presented: string, expected: string): boolean {
  const a = createHash('sha256').update(presented, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

/**
 * The guard. Every refusal is the same 403 with the same fixed body.
 *
 * Uniform by design: the response names no header, variable or path, and does not vary
 * with the reason. The reason is kept in the server-side record instead.
 */
function mcpAuthGuard(
  authKey: string,
  onRefusal?: (reason: McpRefusalReason, req: Request) => void,
  now: () => number = Date.now,
): RequestHandler {
  /**
   * One counter, not one per caller.
   *
   * The listener binds loopback, so every caller presents the same remote address and
   * per-address buckets would all be the same bucket. A single counter states plainly
   * what this endpoint is: single-operator. The state lives in this closure rather than
   * at module scope, so two mounts do not share a lockout.
   */
  let failures = 0;
  let lockedUntil = 0;

  return (req: Request, res: Response, next: NextFunction): void => {
    const presented = req.headers[MCP_KEY_HEADER];
    const header = Array.isArray(presented) ? presented[0] : presented;

    const refuse = (reason: McpRefusalReason): void => {
      // Recording an attempt must never change the answer the attempt gets.
      // Meridian's audit builder threw without `req.user`, and because the guard
      // runs ahead of identity by design the throw reached express, which replaced
      // an opaque 403 with a 500 naming internal paths. The recorder is therefore
      // allowed to fail, and allowed to fail silently, but never allowed to speak.
      if (onRefusal) {
        try {
          onRefusal(reason, req);
        } catch {
          /* deliberately swallowed — see above */
        }
      }
      res.status(403).json({ error: 'Forbidden' });
    };

    /**
     * Counts a failure and starts a lockout at the threshold.
     *
     * A lockout refusal does NOT come through here. Counting those would push the
     * window further out on every retry, so the lockout would stop expiring for a
     * client that keeps trying — turning a bounded delay into an unbounded one.
     */
    const countFailure = (): void => {
      failures += 1;
      if (failures >= MCP_MAX_FAILURES) {
        lockedUntil = now() + MCP_LOCKOUT_MS;
      }
    };

    // Checked before the key itself: while locked out the answer is already decided,
    // so comparing the key would be work with no bearing on the outcome.
    if (now() < lockedUntil) {
      refuse('rate-limited');
      return;
    }

    // The window has passed. Clearing the count here rather than on a timer means no
    // scheduled work, and no lockout outliving the process state it was based on.
    if (lockedUntil !== 0) {
      lockedUntil = 0;
      failures = 0;
    }

    if (!header || !header.trim()) {
      countFailure();
      refuse('missing-key');
      return;
    }

    if (!secretsMatch(header, authKey)) {
      countFailure();
      refuse('invalid-key');
      return;
    }

    // A success clears the count, so occasional mistakes across a long-lived process
    // never accumulate into a lockout for an operator whose key is right.
    failures = 0;
    next();
  };
}

/**
 * Mounts the MCP endpoint behind its guard, or mounts nothing at all.
 *
 * This is the only supported way to mount MCP. It exists so that the ordering —
 * guard, then identity, then the transport — is a property of the code rather than
 * something a future call site has to remember.
 */
export function mountMcpChain(app: Application, options: McpChainOptions): void {
  const { config, path = '/mcp', identityMiddleware, onRefusal, toolContext, now } = options;

  // Not configured means ABSENT. A 404 is the honest answer: there is no endpoint
  // here. Mounting a route that always refuses would advertise the feature.
  if (!config) return;

  // Registration order IS execution order for same-path handlers, so the guard
  // registered here runs before the verb handlers `mountMcpServer` registers below.
  const chain: RequestHandler[] = [mcpAuthGuard(config.authKey, onRefusal, now)];
  if (identityMiddleware) chain.push(identityMiddleware);

  app.use(path, ...chain);
  mountMcpServer(app as Express, path, toolContext);
}
