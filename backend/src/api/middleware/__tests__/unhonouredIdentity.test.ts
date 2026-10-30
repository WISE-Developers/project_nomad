/**
 * #488 criterion 3: a request carrying an identity header Nomad will not honour must
 * produce a warning rather than a silent null.
 *
 * The defect: a caller names its user, the active mode cannot read that header, and Nomad
 * answers 201 while recording `userId: null`. The instance looks healthy. A silent default
 * is the problem — not the acceptance.
 *
 * Why the warning cannot live in `acnAuth`: its internal guard
 * (`if (process.env.NOMAD_DEPLOYMENT_MODE !== 'ACN') return next()`) is unreachable in SAN
 * mode, because `index.ts` only mounts that middleware when the mode is ALREADY ACN. A
 * warning placed there would be a guard that never fires — so this is its own middleware,
 * mounted unconditionally.
 *
 * Scope note: criterion 3 names `X-Nomad-User-Id`, but that header has siblings. ACN
 * identity is unreadable in every SAN mode, and `X-Nomad-User` is unreadable in ACN,
 * oauth and none. Fixing only the one named would be fixing one branch of a class, so
 * both are covered and the test enumerates the members.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock('../../../infrastructure/logging/index.js', () => ({
  logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() },
}));

async function buildApp() {
  const { unhonouredIdentityMiddleware } = await import('../unhonouredIdentity.js');
  const app = express();
  app.use(unhonouredIdentityMiddleware);
  app.get('/probe', (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

/** Everything the warning must mention, so the operator can act on one line. */
function warnText(): string {
  return warn.mock.calls.map((c) => String(c[0])).join('\n');
}

describe('#488 criterion 3 — unhonoured identity headers warn instead of passing silently', () => {
  const envBefore = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.NOMAD_DEPLOYMENT_MODE;
    delete process.env.NOMAD_AUTH_MODE;
    delete process.env.VITE_SIMPLE_AUTH;
  });

  afterEach(() => {
    process.env = { ...envBefore };
  });

  describe('the ACN header in every SAN mode — the reported case', () => {
    it.each(['none', 'simple', 'oauth'])(
      'warns when X-Nomad-User-Id arrives and auth mode is %s',
      async (mode) => {
        process.env.NOMAD_AUTH_MODE = mode;
        const app = await buildApp();

        const res = await request(app).get('/probe').set('x-nomad-user-id', 'u-123');

        // The request still succeeds — this is a warning, not a rejection.
        expect(res.status).toBe(200);

        expect(warn).toHaveBeenCalled();
        const text = warnText();
        expect(text).toContain('X-Nomad-User-Id');
        // It must name the mode, or the operator cannot tell why it was ignored.
        expect(text).toContain(mode);
      }
    );
  });

  describe('the simple header where it cannot be read — the sibling branch', () => {
    it('warns when X-Nomad-User arrives in ACN mode', async () => {
      process.env.NOMAD_DEPLOYMENT_MODE = 'ACN';
      const app = await buildApp();

      await request(app).get('/probe').set('x-nomad-user', 'someone');

      expect(warn).toHaveBeenCalled();
      expect(warnText()).toContain('X-Nomad-User');
    });

    it('warns when X-Nomad-User arrives in oauth mode, where identity is session-based', async () => {
      process.env.NOMAD_AUTH_MODE = 'oauth';
      const app = await buildApp();

      await request(app).get('/probe').set('x-nomad-user', 'someone');

      expect(warn).toHaveBeenCalled();
      expect(warnText()).toContain('X-Nomad-User');
    });
  });

  describe('silence where silence is correct — the negative controls', () => {
    it('does NOT warn when the ACN header arrives in ACN mode', async () => {
      process.env.NOMAD_DEPLOYMENT_MODE = 'ACN';
      const app = await buildApp();

      await request(app).get('/probe').set('x-nomad-user-id', 'u-123');

      expect(warn).not.toHaveBeenCalled();
    });

    it('does NOT warn when the simple header arrives in simple mode', async () => {
      process.env.NOMAD_AUTH_MODE = 'simple';
      const app = await buildApp();

      await request(app).get('/probe').set('x-nomad-user', 'someone');

      expect(warn).not.toHaveBeenCalled();
    });

    it('does NOT warn when no identity header is sent at all', async () => {
      process.env.NOMAD_AUTH_MODE = 'simple';
      const app = await buildApp();

      await request(app).get('/probe');

      expect(warn).not.toHaveBeenCalled();
    });
  });
});
