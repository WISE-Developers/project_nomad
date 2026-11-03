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
  const { errorHandler } = await import('../../../middleware/errorHandler.js');
  const modelsRouter = (await import('../models.js')).default;
  const app = express();
  app.use(express.json());
  app.use(simpleAuthMiddleware);
  app.use('/api/v1', modelsRouter);
  // The REAL error handler, as index.ts mounts it. Without it express's default
  // returns the right status with an empty body, so "the refusal explains itself"
  // could not be tested at all — the assertion would be measuring the harness.
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

  it('CHARACTERIZATION — an UNIDENTIFIED caller can still delete someone else\'s OWNED model', async () => {
    // NOT a remedy, and not in #501's scope. There is no route-level auth anywhere on
    // /api/v1: betterAuthSession annotates and calls next() rather than rejecting, and
    // models.ts mounts no auth gate, so an unidentified caller reaches this handler in
    // every auth mode with an empty identity set.
    //
    // This is strictly worse than #501 and is filed separately, because "open access" may
    // be intentional in `none` mode and the remedy is a decision, not an implementation
    // detail. Pinned here so it cannot change silently in either direction.
    const app = await buildApp();
    const res = await del(app, 'theirs');

    expect(res.status).toBe(200);
    expect(deleteModel).toHaveBeenCalled();
  });
});
