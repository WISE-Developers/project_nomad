/**
 * Trusted origins for OAuth (refs #380).
 *
 * `trustedOrigins` was a single derived entry: the backend's own baseURL.
 * That is correct in production, where the backend serves the frontend from
 * one origin — and wrong everywhere else, including our own development loop.
 *
 * In dev the frontend runs on vite (5177) and proxies /api to the backend
 * (4901). Vite's `changeOrigin` rewrites Host but leaves the browser's
 * `Origin: http://localhost:5177` intact, better-auth compares it against the
 * single trusted entry, and every sign-in returns 403. The page does not
 * change. Nothing appears in the UI. OAuth has therefore been impossible to
 * exercise in dev since the mode was added — the failure was simply silent
 * until better-auth 1.7.5 started logging "Invalid origin".
 *
 * It is not only a dev problem. Any deployment terminating the frontend on a
 * different host or port than the API has the same shape.
 *
 * So origins become configurable — and the way they are configured matters as
 * much as that they are. The failure mode being avoided is a deployment that
 * quietly trusts more than it meant to, so:
 *
 *   - the baseURL is always trusted and cannot be configured away
 *   - a malformed entry is fatal, never skipped, because a silently dropped
 *     origin looks identical to a correctly configured one right up until
 *     sign-in fails
 *   - a wildcard is refused outright rather than honoured
 *
 * That last one is the point of the whole exercise. Making this configurable
 * is only safe if it cannot be configured into "trust anything".
 */

import { describe, it, expect } from 'vitest';
import { resolveTrustedOrigins } from '../betterAuth.js';

const BASE = 'http://localhost:4901';

describe('resolveTrustedOrigins (#380)', () => {
  it('always includes the baseURL when nothing else is configured', () => {
    expect(resolveTrustedOrigins(BASE, undefined)).toEqual([BASE]);
  });

  it('treats an empty or whitespace-only value as nothing configured', () => {
    expect(resolveTrustedOrigins(BASE, '')).toEqual([BASE]);
    expect(resolveTrustedOrigins(BASE, '   ')).toEqual([BASE]);
  });

  it('adds a configured origin — the case that unblocks dev', () => {
    expect(resolveTrustedOrigins(BASE, 'http://localhost:5177')).toEqual([
      BASE,
      'http://localhost:5177',
    ]);
  });

  it('accepts several, comma-separated, and ignores incidental whitespace', () => {
    expect(
      resolveTrustedOrigins(BASE, ' http://localhost:5177 , https://nomad.example.ca '),
    ).toEqual([BASE, 'http://localhost:5177', 'https://nomad.example.ca']);
  });

  it('does not list the baseURL twice when it is also configured explicitly', () => {
    expect(resolveTrustedOrigins(BASE, BASE)).toEqual([BASE]);
  });

  it('rejects a malformed origin rather than skipping it', () => {
    // Skipping would leave a deployment looking correctly configured while
    // the origin it depends on is absent, and the operator finds out at
    // sign-in rather than at startup.
    expect(() => resolveTrustedOrigins(BASE, 'not-a-url')).toThrow(/NOMAD_TRUSTED_ORIGINS/);
  });

  it('rejects a wildcard instead of honouring it', () => {
    expect(() => resolveTrustedOrigins(BASE, '*')).toThrow(/wildcard/i);
    expect(() => resolveTrustedOrigins(BASE, 'http://localhost:5177,*')).toThrow(/wildcard/i);
  });

  it('rejects an origin carrying a path, which would not match anyway', () => {
    // An Origin header is scheme + host + port. Anything more is a
    // misunderstanding that would silently never match.
    expect(() => resolveTrustedOrigins(BASE, 'http://localhost:5177/app')).toThrow(
      /NOMAD_TRUSTED_ORIGINS/,
    );
  });
});
