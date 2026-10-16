import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import {
  resolveUserId,
  resolveUserIdCandidates,
  resolveUserDisplayName,
} from '../resolveUserId.js';

/**
 * Model ownership identity (#346).
 *
 * In oauth mode betterAuthSession sets `req.user = name || email`, so the
 * DISPLAY NAME won and was stored as fire_models.user_id. Session events in the
 * usage log key on the email, so one person appeared twice - as
 * "Franco Nogarin" on model runs and "spydmobile@gmail.com" on login/logout -
 * and the two could not be joined. Observed in production on 2026-08-16.
 *
 * Fix: WRITE the email. For READS, match either the email or the display name
 * during a transition, so models created before the change do not vanish from
 * their owner's list.
 */
function req(fields: Partial<Request> & Record<string, unknown>): Request {
  return fields as Request;
}

describe('resolveUserId — what gets STORED', () => {
  it('prefers the email over the display name in oauth mode', () => {
    expect(
      resolveUserId(req({ user: 'Franco Nogarin', userEmail: 'spydmobile@gmail.com' }))
    ).toBe('spydmobile@gmail.com');
  });

  it('falls back to the display value when there is no email (simple mode)', () => {
    expect(resolveUserId(req({ user: 'franco' }))).toBe('franco');
  });

  it('ignores a blank email rather than storing an empty identity', () => {
    expect(resolveUserId(req({ user: 'Franco Nogarin', userEmail: '   ' }))).toBe(
      'Franco Nogarin'
    );
  });

  it('is undefined when there is no identity at all (none mode)', () => {
    expect(resolveUserId(req({}))).toBeUndefined();
  });

  it('keeps the ACN composite identity unchanged', () => {
    expect(
      resolveUserId(
        req({
          acn: {
            agency: { id: 'gnwt', keyPrefix: 'gnwt_ab12' },
            user: { id: 'u-77', name: 'Rick', role: 'user' },
          },
        })
      )
    ).toBe('Rick (u-77)');
  });
});

describe('resolveUserIdCandidates — what gets MATCHED on read', () => {
  it('returns both email and display name in oauth mode, email first', () => {
    expect(
      resolveUserIdCandidates(
        req({ user: 'Franco Nogarin', userEmail: 'spydmobile@gmail.com' })
      )
    ).toEqual(['spydmobile@gmail.com', 'Franco Nogarin']);
  });

  it('returns a single value when email and display name are the same', () => {
    expect(
      resolveUserIdCandidates(req({ user: 'a@b.ca', userEmail: 'a@b.ca' }))
    ).toEqual(['a@b.ca']);
  });

  it('returns just the header value in simple mode', () => {
    expect(resolveUserIdCandidates(req({ user: 'franco' }))).toEqual(['franco']);
  });

  it('returns nothing when there is no identity — must not match all models', () => {
    expect(resolveUserIdCandidates(req({}))).toEqual([]);
  });

  it('always includes whatever resolveUserId would store', () => {
    const r = req({ user: 'Franco Nogarin', userEmail: 'spydmobile@gmail.com' });
    expect(resolveUserIdCandidates(r)).toContain(resolveUserId(r) as string);
  });
});

describe('resolveUserDisplayName — owner-only presentation', () => {
  const owner = req({
    acn: {
      agency: { id: 'alberta', keyPrefix: 'test' },
      user: {
        id: 'u-77',
        name: 'Keycloak user',
        displayName: 'owner@example.test',
        role: 'admin',
      },
    },
  });

  it('uses the friendly value for the matching owner without changing the stored ID', () => {
    expect(resolveUserDisplayName(owner, 'Keycloak user (u-77)')).toBe(
      'owner@example.test'
    );
    expect(resolveUserId(owner)).toBe('Keycloak user (u-77)');
  });

  it('does not expose the requester display value for another owner or an unowned model', () => {
    expect(resolveUserDisplayName(owner, 'Other user (u-88)')).toBeUndefined();
    expect(resolveUserDisplayName(owner, undefined)).toBeUndefined();
  });

  it('does not treat a legacy display-name match as proof of ownership', () => {
    const request = req({
      user: 'Franco Nogarin',
      userEmail: 'franco@example.test',
    });

    expect(resolveUserDisplayName(request, 'Franco Nogarin')).toBeUndefined();
    expect(resolveUserDisplayName(request, 'franco@example.test')).toBe(
      'Franco Nogarin'
    );
  });

  it('uses the existing ACN name when no separate display value is supplied', () => {
    const request = req({
      acn: {
        agency: { id: 'alberta', keyPrefix: 'test' },
        user: { id: 'u-77', name: 'Rick', role: 'user' },
      },
    });

    expect(resolveUserDisplayName(request, 'Rick (u-77)')).toBe('Rick');
  });
});
