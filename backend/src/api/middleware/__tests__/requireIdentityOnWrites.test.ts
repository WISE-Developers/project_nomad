/**
 * #507 — an unidentified caller must not reach a mutating route.
 *
 * The decision this pins, per auth mode:
 *
 *   none    writes stay OPEN. That is what the mode means; requiring identity
 *           would change the mode rather than fix a bug.
 *   simple  writes REQUIRE a resolved identity. This is attribution, NOT
 *           authentication: `x-nomad-user` is supplied by the client, so it
 *           raises the bar from nothing to a header the caller sets themselves.
 *   oauth   writes REQUIRE a session. This one is real authentication.
 *   ACN     already gated — `acnAuthMiddleware` rejects with 401/403 and is
 *           mounted app-wide when NOMAD_DEPLOYMENT_MODE=ACN. This gate must not
 *           double-decide it.
 *
 * Reads are never gated. #489 established that an anonymous caller may LIST
 * models; refusing them a read here would quietly revoke that.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireIdentityOnWrites } from '../requireIdentityOnWrites.js';

interface Harness {
  req: Request;
  res: Response & { statusCode?: number; body?: unknown };
  next: NextFunction & { called: boolean };
}

function harness(method: string, headers: Record<string, string> = {}, user?: string): Harness {
  const res = {
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  const next = (() => {
    (next as unknown as { called: boolean }).called = true;
  }) as NextFunction & { called: boolean };
  next.called = false;

  const req = { method, headers, user } as unknown as Request;
  return { req, res: res as unknown as Harness['res'], next };
}

const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'];

describe('#507 — requireIdentityOnWrites', () => {
  const envBefore = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NOMAD_DEPLOYMENT_MODE;
  });

  afterEach(() => {
    process.env = { ...envBefore };
  });

  describe('simple mode — identity required for writes', () => {
    beforeEach(() => {
      process.env.NOMAD_AUTH_MODE = 'simple';
    });

    for (const method of MUTATING) {
      it(`refuses ${method} with no identity, and says which header is missing`, () => {
        const h = harness(method);
        requireIdentityOnWrites(h.req, h.res, h.next);

        expect(h.next.called).toBe(false);
        expect(h.res.statusCode).toBe(401);
        // A bare 401 leaves a caller guessing. The body must name the header,
        // the way acnAuth's refusal names its own credentials.
        const body = h.res.body as { error: string; message: string };
        expect(body.error).toBe('Unauthorized');
        expect(body.message).toMatch(/x-nomad-user/i);
      });
    }

    it('allows a write once the caller is identified', () => {
      const h = harness('DELETE', { 'x-nomad-user': 'sage@example.com' }, 'sage@example.com');
      requireIdentityOnWrites(h.req, h.res, h.next);

      expect(h.next.called).toBe(true);
      expect(h.res.statusCode).toBeUndefined();
    });

    it('does NOT gate reads — an anonymous caller may still list models (#489)', () => {
      for (const method of ['GET', 'HEAD', 'OPTIONS']) {
        const h = harness(method);
        requireIdentityOnWrites(h.req, h.res, h.next);
        expect(h.next.called).toBe(true);
        expect(h.res.statusCode).toBeUndefined();
      }
    });
  });

  describe('oauth mode — session required for writes', () => {
    beforeEach(() => {
      process.env.NOMAD_AUTH_MODE = 'oauth';
    });

    it('refuses a write with no session', () => {
      const h = harness('POST');
      requireIdentityOnWrites(h.req, h.res, h.next);

      expect(h.next.called).toBe(false);
      expect(h.res.statusCode).toBe(401);
      // In oauth mode the remedy is signing in, not setting a header.
      expect((h.res.body as { message: string }).message).toMatch(/sign in|session/i);
    });

    it('allows a write when the session resolved to a user', () => {
      // betterAuthSessionMiddleware populates req.user / req.userEmail.
      const h = harness('POST', {}, 'sage@example.com');
      requireIdentityOnWrites(h.req, h.res, h.next);

      expect(h.next.called).toBe(true);
      expect(h.res.statusCode).toBeUndefined();
    });
  });

  describe('none mode — open by design, not by oversight', () => {
    beforeEach(() => {
      process.env.NOMAD_AUTH_MODE = 'none';
    });

    for (const method of MUTATING) {
      it(`allows ${method} with no identity`, () => {
        const h = harness(method);
        requireIdentityOnWrites(h.req, h.res, h.next);

        expect(h.next.called).toBe(true);
        expect(h.res.statusCode).toBeUndefined();
      });
    }
  });

  describe('ACN — already gated upstream, must not double-decide', () => {
    it('passes a write through, because acnAuthMiddleware has already accepted or rejected it', () => {
      process.env.NOMAD_DEPLOYMENT_MODE = 'ACN';
      process.env.NOMAD_AUTH_MODE = 'simple';

      const h = harness('DELETE');
      requireIdentityOnWrites(h.req, h.res, h.next);

      expect(h.next.called).toBe(true);
      expect(h.res.statusCode).toBeUndefined();
    });
  });

  describe('control — the gate is capable of both answers in one run', () => {
    it('refuses then allows, with only the identity differing', () => {
      process.env.NOMAD_AUTH_MODE = 'simple';

      const refused = harness('DELETE');
      requireIdentityOnWrites(refused.req, refused.res, refused.next);

      const allowed = harness('DELETE', { 'x-nomad-user': 'sage' }, 'sage');
      requireIdentityOnWrites(allowed.req, allowed.res, allowed.next);

      // Both halves in the same run. Either alone is satisfiable by a gate that
      // always refuses, or one that never fires.
      expect(refused.res.statusCode).toBe(401);
      expect(refused.next.called).toBe(false);
      expect(allowed.res.statusCode).toBeUndefined();
      expect(allowed.next.called).toBe(true);
    });
  });
});
