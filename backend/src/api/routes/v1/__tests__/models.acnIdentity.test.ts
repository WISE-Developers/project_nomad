/**
 * Identity on the model CREATE path (#488) — ACN mode, and simple mode.
 *
 * A downstream ACN consumer reported that every model it creates is stored with
 * `userId: null` — five pre-existing models and one created live, all null, which
 * is a never-worked pattern rather than a regression.
 *
 * `POST /models` already calls `resolveUserId(req)` (models.ts:402), and
 * `resolveUserId` already handles the ACN case (`req.acn.user.id`). So the open
 * question was NOT whether the route reads identity, but whether `req.acn` is ever
 * populated. These two tests answer it locally instead of waiting on an instance's
 * startup log, because the discriminator is an environment variable:
 *
 *   acnAuthMiddleware returns next() immediately when
 *   process.env.NOMAD_DEPLOYMENT_MODE !== 'ACN'   (acnAuth.ts:157-159)
 *
 * Test 1 drives the full chain IN ACN mode and asserts identity reaches the
 * repository. If it passes, the create path is innocent and the reported defect is
 * configuration.
 *
 * Test 2 is a CHARACTERIZATION test of the same request OUTSIDE ACN mode. It pins
 * today's behaviour — 201, `userId: null`, no warning — and it documents a defect
 * rather than endorsing it: a request that carries `X-Nomad-User-Id` which Nomad
 * will not honour is answered as success, and the model records nobody. The remedy
 * (warn, or reject) is a product decision and is deliberately NOT pinned here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ─── Hoisted mocks ──────────────────────────────────────────────
/**
 * `save` is typed with the one field these tests read. Declaring the parameter
 * rather than casting `mock.calls[0][0]` keeps tsc able to speak: a cast would
 * have hidden the fact that a no-arg mock records a zero-length argument tuple.
 */
interface SavedModel {
  userId?: string;
}

const { getModelRepository, save } = vi.hoisted(() => {
  const save = vi.fn(async (_model: { userId?: string }) => undefined);
  return {
    save,
    getModelRepository: vi.fn(() => ({ save })),
  };
});

vi.mock('../../../../infrastructure/database/index.js', () => ({
  getModelRepository,
  getResultRepository: vi.fn(() => ({})),
}));

vi.mock('../../../../infrastructure/services/index.js', () => ({
  getModelExecutionService: vi.fn(() => ({})),
}));

vi.mock('../../../../infrastructure/engines/index.js', () => ({
  getEngine: vi.fn(() => ({})),
  getWorkspaceAwareEngine: vi.fn(() => ({})),
}));

vi.mock('../../../../infrastructure/firestarr/index.js', () => ({
  generateArrivalTile: vi.fn(),
  findArrivalTifs: vi.fn(),
  getRasterBounds: vi.fn(),
}));

const AGENCY_ID = 'testagency';
const AGENCY_KEY = 'test-agency-key';
const USER_UUID = '00000000-0000-4000-8000-000000000000';
const USER_NAME = 'Test Modeller';

/** The identity headers a real ACN consumer sends on every proxied call. */
const ACN_HEADERS = {
  'x-nomad-agency-id': AGENCY_ID,
  'x-nomad-agency-key': AGENCY_KEY,
  'x-nomad-user-id': USER_UUID,
  'x-nomad-user-role': 'admin',
  'x-nomad-user-name': USER_NAME,
};

async function buildApp() {
  const { acnAuthMiddleware } = await import('../../../middleware/acnAuth.js');
  const modelsRouter = (await import('../models.js')).default;
  const app = express();
  app.use(express.json());
  app.use(acnAuthMiddleware);
  app.use('/api/v1', modelsRouter);
  return app;
}

describe('#488 — ACN identity on POST /models', () => {
  const envBefore = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env[`NOMAD_AGENCY_KEY_${AGENCY_ID.toUpperCase()}`] = AGENCY_KEY;
  });

  afterEach(() => {
    process.env = { ...envBefore };
  });

  it('stores the ACN user identity when NOMAD_DEPLOYMENT_MODE=ACN', async () => {
    process.env.NOMAD_DEPLOYMENT_MODE = 'ACN';
    const app = await buildApp();

    const res = await request(app)
      .post('/api/v1/models')
      .set(ACN_HEADERS)
      .send({ name: 'identity probe', engineType: 'firestarr' });

    expect(res.status).toBe(201);

    // The response must name the author...
    expect(res.body.userId).not.toBeNull();
    expect(res.body.userId).toContain(USER_UUID);

    // ...and so must the row that was persisted. Asserting only the response
    // would pass on a route that echoes the header without saving it.
    expect(save).toHaveBeenCalledTimes(1);
    const saved: SavedModel = save.mock.calls[0][0];
    expect(saved.userId).toBe(`${USER_NAME} (${USER_UUID})`);
  });

  it('CHARACTERIZATION: outside ACN mode the same identity headers are silently discarded', async () => {
    delete process.env.NOMAD_DEPLOYMENT_MODE;
    const app = await buildApp();

    const res = await request(app)
      .post('/api/v1/models')
      .set(ACN_HEADERS)
      .send({ name: 'identity probe', engineType: 'firestarr' });

    // Today: the request succeeds and the model records nobody. This is #488's
    // defect, pinned so a fix has to change it deliberately.
    expect(res.status).toBe(201);
    expect(res.body.userId).toBeNull();

    expect(save).toHaveBeenCalledTimes(1);
    const saved: SavedModel = save.mock.calls[0][0];
    expect(saved.userId).toBeUndefined();
  });
});

/**
 * SIMPLE MODE — the path the real consumer hits.
 *
 * Both the staging and production instances run `NOMAD_AUTH_MODE=simple`, and the
 * consumer sends `X-Nomad-User` on writes. So the operative question for #488 is not the
 * ACN path at all: it is whether a simple-mode create persists `req.user`.
 *
 * `resolveUserId` falls through `req.acn` and `req.userEmail` to `return req.user`, so the
 * code says yes. These tests establish it, because "the code says yes" is not a
 * measurement — and the existing deployed models cannot answer it: all five were created
 * before the consumer sent any identity header, so they are a pre-fix population and
 * physically cannot test a post-fix build.
 */
describe('#488 — simple-mode identity on POST /models', () => {
  const envBefore = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.NOMAD_DEPLOYMENT_MODE;
    process.env.NOMAD_AUTH_MODE = 'simple';
  });

  afterEach(() => {
    process.env = { ...envBefore };
  });

  async function buildSimpleApp() {
    const { simpleAuthMiddleware } = await import('../../../middleware/simpleAuth.js');
    const modelsRouter = (await import('../models.js')).default;
    const app = express();
    app.use(express.json());
    app.use(simpleAuthMiddleware);
    app.use('/api/v1', modelsRouter);
    return app;
  }

  it('persists the X-Nomad-User value as the author', async () => {
    const app = await buildSimpleApp();

    const res = await request(app)
      .post('/api/v1/models')
      .set('x-nomad-user', 'fire-analyst-7')
      .send({ name: 'simple mode create', engineType: 'firestarr' });

    expect(res.status).toBe(201);
    expect(res.body.userId).toBe('fire-analyst-7');

    // And on the row, not only in the echoed response.
    expect(save).toHaveBeenCalledTimes(1);
    const saved: SavedModel = save.mock.calls[0][0];
    expect(saved.userId).toBe('fire-analyst-7');
  });

  it('records null when no identity header is sent — the pre-fix shape', async () => {
    const app = await buildSimpleApp();

    const res = await request(app)
      .post('/api/v1/models')
      .send({ name: 'no identity', engineType: 'firestarr' });

    expect(res.status).toBe(201);
    expect(res.body.userId).toBeNull();

    const saved: SavedModel = save.mock.calls[0][0];
    expect(saved.userId).toBeUndefined();
  });
});
