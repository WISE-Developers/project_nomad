/**
 * Resolve User Identity
 *
 * Returns the current user ID regardless of deployment mode.
 * ACN mode: reads from req.acn.user.id
 * SAN mode: reads from req.userEmail (oauth) or req.user
 */

import { Request } from 'express';

/**
 * Resolve the identity to STORE against a user's data.
 *
 * In oauth mode this is the EMAIL, not the display name. betterAuthSession sets
 * `req.user = name || email` for display, so the name would otherwise win - and
 * a name is mutable and not unique. Session events in the usage log key on the
 * email, so storing the name made one person appear as two identities that
 * could not be joined (#346, observed in production 2026-08-16).
 *
 * ACN context takes precedence and keeps its composite "name (uuid)" form for
 * readable display plus traceability.
 */
export function resolveUserId(req: Request): string | undefined {
  if (req.acn) {
    const { id, name } = req.acn.user;
    return name ? `${name} (${id})` : id;
  }

  const email = req.userEmail?.trim();
  if (email) return email;

  return req.user;
}

/**
 * Resolve every identity that should MATCH this user's existing data.
 *
 * Transitional: models created before #346 are keyed by display name, while new
 * ones are keyed by email. Matching both means a user does not open Nomad to
 * find their earlier work missing. Write is email-only; only the read side is
 * permissive, so the ambiguity stays out of the data.
 *
 * This can be reduced to `[resolveUserId(req)]` once pre-#346 models have aged
 * out of use.
 *
 * @returns identities to match, most authoritative first. Empty when there is
 *          no identity at all - callers must treat that as "no filter applies",
 *          never as "match everything".
 */
export function resolveUserIdCandidates(req: Request): string[] {
  const stored = resolveUserId(req);
  if (!stored) return [];

  const candidates = [stored];

  // The pre-#346 display value, when it differs from what we now store.
  const display = req.user?.trim();
  if (display && display !== stored) {
    candidates.push(display);
  }

  return candidates;
}
