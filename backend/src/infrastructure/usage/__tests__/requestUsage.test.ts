import { describe, it, expect } from 'vitest';
import { actorFromRequest } from '../requestUsage.js';
import type { AuthMode } from '../../../domain/value-objects/UsageEvent.js';

/**
 * Actor resolution for request-scoped usage events, e.g. exports (#332).
 *
 * req.user is a DISPLAY string - betterAuthSession sets it to `name || email`.
 * The usage log is keyed on email, so the middleware also stashes req.userEmail
 * and that is preferred here. Otherwise the same person would appear as
 * "Franco" in export events and "franco@example.ca" in run events.
 */
function req(fields: { user?: string; userEmail?: string }) {
  return fields as { user?: string; userEmail?: string };
}

describe('actorFromRequest', () => {
  const modes: AuthMode[] = ['none', 'simple', 'oauth', 'acn'];

  it('returns "User" in none mode regardless of what is on the request', () => {
    expect(actorFromRequest(req({ user: 'ignored' }), 'none')).toBe('User');
  });

  it('uses the request user in simple mode', () => {
    expect(actorFromRequest(req({ user: 'franco' }), 'simple')).toBe('franco');
  });

  it('falls back to "Unknown User" in simple mode with no user', () => {
    expect(actorFromRequest(req({}), 'simple')).toBe('Unknown User');
  });

  it('prefers the email over the display name in oauth mode', () => {
    expect(
      actorFromRequest(req({ user: 'Franco', userEmail: 'franco@example.ca' }), 'oauth')
    ).toBe('franco@example.ca');
  });

  it('falls back to "Unauthenticated User" in oauth mode with no session', () => {
    expect(actorFromRequest(req({}), 'oauth')).toBe('Unauthenticated User');
  });

  it('uses the agency user id in acn mode', () => {
    expect(actorFromRequest(req({ user: 'agency-user-77' }), 'acn')).toBe('agency-user-77');
  });

  it('never returns an empty string in any mode', () => {
    for (const mode of modes) {
      expect(actorFromRequest(req({}), mode).length).toBeGreaterThan(0);
      expect(actorFromRequest(req({ user: '   ' }), mode).length).toBeGreaterThan(0);
    }
  });

  it('treats a blank email as absent rather than as an identity', () => {
    expect(actorFromRequest(req({ user: 'Franco', userEmail: '  ' }), 'oauth')).toBe(
      'Unauthenticated User'
    );
  });
});
