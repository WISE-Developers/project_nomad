import type { AuthMode, UsageEventType } from '../../domain/value-objects/UsageEvent.js';
import { createUsageEvent, resolveActor } from '../../application/usage/usageEvent.js';
import { getUsageLogger } from './index.js';
import { EnvironmentService } from '../config/EnvironmentService.js';
import { resolveAuthMode } from '../../api/middleware/authMode.js';

/** The identity fields a request may carry, whatever the auth mode. */
export interface UsageRequestLike {
  user?: string;
  /** Set by betterAuthSession in oauth mode. Preferred over `user`. */
  userEmail?: string;
}

/**
 * Resolves the actor for a request-scoped event.
 *
 * req.user is a DISPLAY string (betterAuthSession sets it to `name || email`),
 * so oauth prefers req.userEmail. Without that the same person would appear as
 * a name in export events and an email in run events, and the two could not be
 * joined.
 */
export function actorFromRequest(req: UsageRequestLike, authMode: AuthMode): string {
  switch (authMode) {
    case 'none':
      return resolveActor({ authMode });
    case 'simple':
      return resolveActor({ authMode, header: req.user });
    case 'oauth':
      return resolveActor({ authMode, email: req.userEmail, name: req.user });
    case 'acn':
      return resolveActor({ authMode, userId: req.user });
  }
}

/**
 * Records a request-scoped usage event.
 *
 * Never throws and never blocks the response: an export must not fail because
 * the usage log could not be written.
 */
export async function recordRequestEvent(
  req: UsageRequestLike,
  type: UsageEventType,
  options: { modelId?: string; detail?: Record<string, unknown> } = {}
): Promise<void> {
  try {
    const authMode = resolveAuthMode() as AuthMode;
    await getUsageLogger().record(
      createUsageEvent({
        type,
        actor: actorFromRequest(req, authMode),
        zone: EnvironmentService.getInstance().getHomeTimezone(),
        now: new Date(),
        modelId: options.modelId,
        detail: options.detail,
      })
    );
  } catch {
    // Swallowed by design; the adapter logs its own write failures.
  }
}
