/**
 * DELETE /models/:id — an unowned model is not deletable through the API (#501).
 *
 * DECIDED (#501, owner, 2026-11-02): a model with `userId: null` is **unowned**, and an
 * unowned row cannot be deleted through the API until it is owned. Ownership of
 * historical rows comes from a migration or an operator-run script — **there is no claim
 * endpoint, and adding one would reopen this**, because a self-service claim lets any
 * caller take a row and then delete it, at the cost of one extra request.
 *
 * Why this mattered: because of #488 every model created before that fix stores
 * `userId: null`, so "unowned" was not an edge case, it was the entire history — and the
 * old guard let any identified caller delete all of it, one row at a time.
 *
 * THE REFUSAL APPLIES TO EVERY CALLER, AND THAT IS FORCED BY THE CODE RATHER THAN CHOSEN.
 * `simpleAuthMiddleware` sets `req.user` only when the header is present and then calls
 * `next()`, so `resolveUserIdCandidates` returns `[]` for an unidentified caller. A guard
 * written as "identified callers may not delete unowned rows" would therefore be bypassed
 * by omitting one header — decorative in exactly the way the no-claim-endpoint constraint
 * exists to prevent.
 *
 * Counterpart to #489, which decided the same `null` means *visible to everyone*. Visible
 * and deletable were deliberately separated: the two endpoints disagreed, and this is where
 * they stop.
 */

import { serveInTest } from '../../../../test/sharedServer.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

interface Row {
  id: string;
  name: string;
  engineType: string;
  status: string;
  createdAt: Date;
  userId?: string;
}

const ME = 'me@example.test';
const SOMEONE_ELSE = 'other@example.test';

const { getModelRepository, deleteModel, deleteByModelId } = vi.hoisted(() => {
  const findById = vi.fn(async (id: string) => {
    const rows = (globalThis as { __rows?: Row[] }).__rows ?? [];
    return rows.find((r) => r.id === String(id)) ?? null;
  });
  const deleteModel = vi.fn(async () => undefined);
  const deleteByModelId = vi.fn(async () => 0);
  return {
    deleteModel,
    deleteByModelId,
    getModelRepository: vi.fn(() => ({ findById, delete: deleteModel })),
  };
});

vi.mock('../../../../infrastructure/database/index.js', () => ({
  getModelRepository,
  getResultRepository: vi.fn(() => ({ deleteByModelId })),
  getJobRepository: vi.fn(() => ({ deleteByModelId })),
}));
vi.mock('../../../../infrastructure/services/index.js', () => ({
  getModelExecutionService: vi.fn(() => ({})),
}));
vi.mock('../../../../infrastructure/engines/index.js', () => ({
  getEngine: vi.fn(() => ({ cleanup: vi.fn(async () => undefined) })),
  getWorkspaceAwareEngine: vi.fn(() => ({ getWorkingDirectory: vi.fn(() => undefined) })),
}));
vi.mock('../../../../infrastructure/firestarr/index.js', () => ({
  generateArrivalTile: vi.fn(),
  findArrivalTifs: vi.fn(),
  getRasterBounds: vi.fn(),
}));

const ROWS: Row[] = [
  { id: 'mine', name: 'mine', engineType: 'firestarr', status: 'draft', createdAt: new Date(), userId: ME },
  { id: 'theirs', name: 'theirs', engineType: 'firestarr', status: 'draft', createdAt: new Date(), userId: SOMEONE_ELSE },
  // The #488 shape: no recorded author.
  { id: 'legacy-row', name: 'legacy row', engineType: 'firestarr', status: 'draft', createdAt: new Date() },
];

async function buildApp() {
  const { simpleAuthMiddleware } = await import('../../../middleware/simpleAuth.js');
  const { requireIdentityOnWrites } = await import(
    '../../../middleware/requireIdentityOnWrites.js'
  );
  const { errorHandler } = await import('../../../middleware/errorHandler.js');
  const modelsRouter = (await import('../models.js')).default;
  const app = express();
  app.use(express.json());
  app.use(simpleAuthMiddleware);
  // #507's gate, in the same position index.ts mounts it: after the mode-specific
  // auth and BEFORE the router. Without it this harness would still answer 200 to
  // an unidentified delete and the assertion below would be measuring the harness
  // rather than the application.
  app.use('/api/v1', requireIdentityOnWrites);
  app.use('/api/v1', modelsRouter);
  // The REAL error handler, as index.ts mounts it. Without it express's default
  // returns the right status with an empty body, so "the refusal explains itself"
  // could not be tested at all — the assertion would be measuring the harness.
  app.use(errorHandler);
  return app;
}

/**
 * A harness in `oauth` shape (#489/#501 had NO oauth coverage until 2026-11-03).
 *
 * `betterAuthSessionMiddleware` resolves a Better Auth session cookie, which cannot be
 * manufactured here, so this stands in for it. It sets EXACTLY the two fields that
 * middleware sets, and nothing else:
 *
 *   req.user      = session.user.name || session.user.email   (display)
 *   req.userEmail = session.user.email                        (stable identity)
 *
 * See `src/api/middleware/betterAuthSession.ts:49-51`. The stub is deliberately dumb:
 * if it did anything cleverer than copy those two fields it would be testing itself.
 * What is under test is `resolveUserIdCandidates` and the ownership guard downstream,
 * which only ever read those fields.
 */
async function buildOauthApp(session?: { email: string; name?: string }) {
  const { requireIdentityOnWrites } = await import(
    '../../../middleware/requireIdentityOnWrites.js'
  );
  const { errorHandler } = await import('../../../middleware/errorHandler.js');
  const modelsRouter = (await import('../models.js')).default;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (session) {
      (req as express.Request).user = session.name || session.email;
      (req as express.Request & { userEmail?: string }).userEmail = session.email;
    }
    next();
  });
  app.use('/api/v1', requireIdentityOnWrites);
  app.use('/api/v1', modelsRouter);
  app.use(errorHandler);
  return app;
}

function del(app: express.Express, id: string, as?: string) {
  const r = request(serveInTest(app)).delete(`/api/v1/models/${id}`);
  return as ? r.set('x-nomad-user', as) : r;
}

describe('#501 — DELETE /models/:id and unowned rows', () => {
  const envBefore = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    (globalThis as { __rows?: Row[] }).__rows = ROWS;
    process.env.NOMAD_AUTH_MODE = 'simple';
  });

  afterEach(() => {
    process.env = { ...envBefore };
    delete (globalThis as { __rows?: Row[] }).__rows;
  });

  it('refuses an IDENTIFIED caller deleting an unowned model, and does not delete it', async () => {
    const app = await buildApp();
    const res = await del(app, 'legacy-row', ME);

    expect(res.status).toBeGreaterThanOrEqual(400);
    // The status code alone would pass if the handler threw for an unrelated reason.
    // What matters is that the row survived.
    expect(deleteModel).not.toHaveBeenCalled();
  });

  it('refuses an UNIDENTIFIED caller too — otherwise the guard is bypassed by omitting a header', async () => {
    const app = await buildApp();
    const res = await del(app, 'legacy-row');

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(deleteModel).not.toHaveBeenCalled();
  });

  it('explains WHY, naming ownership rather than returning a bare error', async () => {
    const app = await buildApp();
    const res = await del(app, 'legacy-row', ME);

    // The fixture id is deliberately 'legacy-row', NOT 'unowned': the delete success
    // body reads "Model <id> deleted", so an id containing the word would have matched
    // this regex on a 200 and passed while the guard did nothing. It did, on the first
    // run of this file.
    expect(JSON.stringify(res.body).toLowerCase()).toMatch(/owner|unowned|ownership/);
  });

  it('CONTROL — an identified caller can still delete their OWN model', async () => {
    // Without this, a guard that refused every delete would pass every test above.
    const app = await buildApp();
    const res = await del(app, 'mine', ME);

    expect(res.status).toBe(200);
    expect(deleteModel).toHaveBeenCalled();
  });

  it("still refuses an identified caller deleting someone else's model (unchanged)", async () => {
    const app = await buildApp();
    const res = await del(app, 'theirs', ME);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(deleteModel).not.toHaveBeenCalled();
  });

  it('#507 — an UNIDENTIFIED caller is now REFUSED before reaching the handler', async () => {
    // Replaces the characterization test that pinned a 200 here. The decision, per
    // auth mode, is recorded on #507: `simple` and `oauth` require an identity for a
    // mutating request; `none` stays open because that is what the mode means.
    //
    // This case runs in `simple` mode (set in beforeEach), so the refusal is a 401
    // from the gate rather than the ownership error from the handler -- and
    // deleteModel must never be reached at all.
    const app = await buildApp();
    const res = await del(app, 'theirs');

    expect(res.status).toBe(401);
    expect(deleteModel).not.toHaveBeenCalled();
    expect(res.body.message).toMatch(/x-nomad-user/i);
  });

  it('#507 CONTROL — the same delete SUCCEEDS once the owner identifies themselves', async () => {
    // Without this, the test above is satisfied by a gate that refuses everything.
    const app = await buildApp();
    const res = await del(app, 'theirs', SOMEONE_ELSE);

    expect(res.status).toBe(200);
    expect(deleteModel).toHaveBeenCalled();
  });

  it('#507 — `none` mode keeps the unidentified delete open, by decision', async () => {
    // The mode means open access. A blanket "identity required" would have changed
    // what `none` does, which is why the ruling is per mode rather than global.
    process.env.NOMAD_AUTH_MODE = 'none';
    const app = await buildApp();
    const res = await del(app, 'theirs');

    expect(res.status).toBe(200);
    expect(deleteModel).toHaveBeenCalled();
  });
});

describe('#489/#501 under OAUTH — the mode the demo actually runs', () => {
  const envBefore = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    (globalThis as { __rows?: Row[] }).__rows = ROWS;
    process.env.NOMAD_AUTH_MODE = 'oauth';
  });

  afterEach(() => {
    process.env = { ...envBefore };
    delete (globalThis as { __rows?: Row[] }).__rows;
  });

  it('CONTROL — with no session the write is refused, so these tests cannot pass unauthenticated', async () => {
    // Without this, every assertion below could be satisfied by a harness that
    // never applies the session at all.
    const app = await buildOauthApp(undefined);
    const res = await request(serveInTest(app)).delete(`/api/v1/models/theirs`);

    expect(res.status).toBe(401);
    expect(deleteModel).not.toHaveBeenCalled();
  });

  it('an oauth caller deletes their OWN model, identified by the session EMAIL', async () => {
    // In oauth the stored identity is req.userEmail, NOT the header req.user that
    // `simple` supplies. This is the branch of resolveUserId that no #501 test reached.
    const app = await buildOauthApp({ email: ME, name: 'Test Modeller' });
    const res = await request(serveInTest(app)).delete(`/api/v1/models/mine`);

    expect(res.status).toBe(200);
    expect(deleteModel).toHaveBeenCalled();
  });

  it("an oauth caller cannot delete SOMEONE ELSE's model", async () => {
    const app = await buildOauthApp({ email: ME, name: 'Test Modeller' });
    const res = await request(serveInTest(app)).delete(`/api/v1/models/theirs`);

    // 400, not 403: the guard raises ValidationError('Permission denied'), which
    // errorHandler maps to 400. The simple-mode tests above use >= 400 for the same
    // reason. Asserting 403 was MY expectation, not the application's contract.
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/permission/i);
    expect(deleteModel).not.toHaveBeenCalled();
  });

  it('an oauth caller cannot delete an UNOWNED model either — #501 holds in this mode too', async () => {
    const app = await buildOauthApp({ email: ME, name: 'Test Modeller' });
    const res = await request(serveInTest(app)).delete(`/api/v1/models/legacy-row`);

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/own|permission/i);
    expect(deleteModel).not.toHaveBeenCalled();
  });

  it('an oauth caller still owns a row keyed by their PRE-#346 DISPLAY NAME', async () => {
    // The reason resolveUserIdCandidates returns two candidates rather than one.
    // A row written before #346 carries the display value; the session now resolves
    // to the email. Nothing before today executed this path under oauth, and it is
    // the one most likely to have been wrong.
    const DISPLAY = 'Test Modeller';
    (globalThis as { __rows?: Row[] }).__rows = [
      { id: 'legacy-display', name: 'legacy display row', engineType: 'firestarr',
        status: 'draft', createdAt: new Date(), userId: DISPLAY },
    ];

    const app = await buildOauthApp({ email: ME, name: DISPLAY });
    const res = await request(serveInTest(app)).delete(`/api/v1/models/legacy-display`);

    expect(res.status).toBe(200);
    expect(deleteModel).toHaveBeenCalled();
  });

  it('CONTROL — a DIFFERENT display name does not grant ownership of that row', async () => {
    // Otherwise the test above would pass for a candidate list that matches anything.
    (globalThis as { __rows?: Row[] }).__rows = [
      { id: 'legacy-display', name: 'legacy display row', engineType: 'firestarr',
        status: 'draft', createdAt: new Date(), userId: 'Someone Entirely Else' },
    ];

    const app = await buildOauthApp({ email: ME, name: 'Test Modeller' });
    const res = await request(serveInTest(app)).delete(`/api/v1/models/legacy-display`);

    expect(res.status).toBe(400);
    expect(deleteModel).not.toHaveBeenCalled();
  });
});
