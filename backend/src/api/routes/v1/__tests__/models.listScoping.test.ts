/**
 * `GET /models` scoping by caller identity (#489).
 *
 * THIS FILE WAS A CHARACTERIZATION TEST AND HAS BEEN DELIBERATELY REWRITTEN.
 *
 * Its previous version pinned the defect: an identified caller's list excluded every
 * row whose `userId` was null, so a consumer that started sending `X-Nomad-User`
 * went from 5 models to 0 against a deployed instance. It carried an explicit note
 * that when the decision landed these tests "must change deliberately rather than
 * quietly going green on new behaviour". The decision has landed, so this is that
 * deliberate change rather than an edit-until-green.
 *
 * DECIDED (#489, owner, 2026-11-02): identity scoping stays the DEFAULT, and
 * `userId: null` means **unowned and visible to everyone**. The rejected alternative
 * was scoping only on an explicit `?mine=true`, which is cleaner API design but would
 * silently widen what existing consumers see with no code change on their side.
 *
 * Criterion 1 is also covered here: a response says whether identity narrowed it, so a
 * caller can tell "none exist" from "none of yours".
 *
 * SCOPE: visibility only. Whether an unowned row may be DELETED is #501 and is still
 * open — the two endpoints deliberately disagree until that is answered, and nothing
 * here asserts anything about DELETE.
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
  notes?: string;
}

/**
 * Three rows: the caller's own, another operator's, and one with no recorded author
 * (the #488 shape). The second row is what makes this a test rather than a tautology —
 * without it, "shows everything" and "shows mine plus unowned" are indistinguishable.
 */
const ROWS: Row[] = [
  {
    id: 'm-authored',
    name: 'authored run',
    engineType: 'firestarr',
    status: 'draft',
    createdAt: new Date('2026-10-01T00:00:00Z'),
    userId: 'Test Modeller (00000000-0000-4000-8000-000000000000)',
  },
  {
    id: 'm-other',
    name: 'another operator run',
    engineType: 'firestarr',
    status: 'draft',
    createdAt: new Date('2026-10-02T00:00:00Z'),
    userId: 'Someone Else (11111111-1111-4111-8111-111111111111)',
  },
  {
    id: 'm-nullauthor',
    name: 'legacy run with no recorded author',
    engineType: 'firestarr',
    status: 'draft',
    createdAt: new Date('2026-06-30T00:00:00Z'),
    // userId deliberately absent — this is what every proxied create produced (#488)
  },
];

const ME = 'Test Modeller (00000000-0000-4000-8000-000000000000)';

const { getModelRepository, find } = vi.hoisted(() => {
  /**
   * Applies the filter the way the Knex repository does, including `includeUnowned`
   * (which becomes a grouped `orWhereNull('user_id')`), so these tests show the
   * CONSEQUENCE of the filter rather than only its shape. A mock that ignored the
   * filter would pass whatever the handler did, which is the failure mode this file
   * exists to catch.
   */
  const find = vi.fn(async (filter: { userId?: string | string[]; includeUnowned?: boolean }) => {
    const rows = (globalThis as { __rows?: Row[] }).__rows ?? [];
    if (!filter || filter.userId === undefined) return { models: rows, total: rows.length };
    const wanted = Array.isArray(filter.userId) ? filter.userId : [filter.userId];
    const matched = rows.filter(
      (r) =>
        (r.userId !== undefined && wanted.includes(r.userId)) ||
        (filter.includeUnowned === true && r.userId === undefined)
    );
    return { models: matched, total: matched.length };
  });
  return { find, getModelRepository: vi.fn(() => ({ find })) };
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
  getWorkspaceAwareEngine: vi.fn(() => ({ getWorkingDirectory: vi.fn(() => undefined) })),
}));
vi.mock('../../../../infrastructure/firestarr/index.js', () => ({
  generateArrivalTile: vi.fn(),
  findArrivalTifs: vi.fn(),
  getRasterBounds: vi.fn(),
}));

async function buildApp() {
  const { simpleAuthMiddleware } = await import('../../../middleware/simpleAuth.js');
  const modelsRouter = (await import('../models.js')).default;
  const app = express();
  app.use(express.json());
  app.use(simpleAuthMiddleware);
  app.use('/api/v1', modelsRouter);
  return app;
}

/**
 * A harness in `oauth` shape. #489 had NO oauth coverage until 2026-11-03, while the
 * CIFFC demo has run `oauth` throughout — so the scoping this issue decided had never
 * executed in the mode it actually ships in.
 *
 * Stands in for `betterAuthSessionMiddleware`, whose Better Auth session cookie cannot
 * be manufactured here. It sets EXACTLY the two fields that middleware sets
 * (`betterAuthSession.ts:49-51`) and nothing else:
 *
 *   req.user      = session.user.name || session.user.email
 *   req.userEmail = session.user.email
 *
 * What is under test is `resolveUserIdCandidates` and the repository filter downstream,
 * which read only those two fields.
 */
async function buildOauthApp(session?: { email: string; name?: string }) {
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
  app.use('/api/v1', modelsRouter);
  return app;
}

const idsOf = (res: { body: { models: { id: string }[] } }) => res.body.models.map((m) => m.id);

describe('#489 — GET /models: scoping stays the default, unowned rows stay visible', () => {
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

  it('an UNIDENTIFIED caller gets every row, and the response says it was not narrowed', async () => {
    const app = await buildApp();
    const res = await request(serveInTest(app)).get('/api/v1/models');

    expect(res.status).toBe(200);
    expect(find).toHaveBeenCalledWith({});
    expect(idsOf(res)).toEqual(['m-authored', 'm-other', 'm-nullauthor']);
    expect(res.body.filtered).toEqual({ byIdentity: false, includesUnowned: true });
  });

  it('an IDENTIFIED caller sees their own rows AND the unowned row, but not another operator\'s', async () => {
    // This is the behaviour change. Previously the null-author row was absent here.
    const app = await buildApp();
    const res = await request(serveInTest(app)).get('/api/v1/models').set('x-nomad-user', ME);

    expect(res.status).toBe(200);

    const ids = idsOf(res);
    expect(ids).toContain('m-authored');
    expect(ids).toContain('m-nullauthor');
    // Scoping is still the default: this is NOT an unfiltered list.
    expect(ids).not.toContain('m-other');

    const filterUsed = find.mock.calls[0][0];
    expect(filterUsed.includeUnowned).toBe(true);
    expect(JSON.stringify(filterUsed.userId)).toContain('Test Modeller');
  });

  it('an identity matching NO owned rows still sees the unowned row, not an empty list', async () => {
    // The measured symptom: a consumer went 5 -> 0 because every row was null-author.
    // The whole point of the decision is that this case stops returning nothing.
    const app = await buildApp();
    const res = await request(serveInTest(app))
      .get('/api/v1/models')
      .set('x-nomad-user', 'somebody-with-no-models');

    expect(res.status).toBe(200);
    expect(idsOf(res)).toEqual(['m-nullauthor']);
  });

  it('says it was narrowed by identity, so a caller can tell "none exist" from "none of yours"', async () => {
    const app = await buildApp();
    const res = await request(serveInTest(app))
      .get('/api/v1/models')
      .set('x-nomad-user', 'somebody-with-no-models');

    expect(res.body.filtered).toEqual({ byIdentity: true, includesUnowned: true });
  });

  it('CONTROL — with no unowned rows present, an identified caller still sees only their own', async () => {
    // Without this, "includesUnowned" could be masking a filter that had stopped
    // scoping at all, and every expectation above would still pass.
    (globalThis as { __rows?: Row[] }).__rows = ROWS.filter((r) => r.userId !== undefined);

    const app = await buildApp();
    const res = await request(serveInTest(app)).get('/api/v1/models').set('x-nomad-user', ME);

    expect(idsOf(res)).toEqual(['m-authored']);
  });
});

describe('#489 under OAUTH — the mode the demo actually runs', () => {
  const envBefore = { ...process.env };
  const EMAIL = 'modeller@example.test';

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

  it('CONTROL — no session means unidentified, and reads are NOT gated (#507 covers writes only)', async () => {
    // Establishes that the harness can produce the unidentified case at all; without
    // it, a stub that always applied a session would make every test below vacuous.
    const app = await buildOauthApp(undefined);
    const res = await request(serveInTest(app)).get('/api/v1/models');

    expect(res.status).toBe(200);
    expect(idsOf(res)).toEqual(['m-authored', 'm-other', 'm-nullauthor']);
    expect(res.body.filtered).toEqual({ byIdentity: false, includesUnowned: true });
  });

  it('an oauth caller identified by EMAIL sees their own rows and the unowned row', async () => {
    // In oauth the stored identity is req.userEmail, not the header `simple` supplies.
    (globalThis as { __rows?: Row[] }).__rows = [
      { ...ROWS[0], userId: EMAIL },
      ROWS[1],
      ROWS[2],
    ];

    const app = await buildOauthApp({ email: EMAIL, name: 'Test Modeller' });
    const res = await request(serveInTest(app)).get('/api/v1/models');

    expect(res.status).toBe(200);
    const ids = idsOf(res);
    expect(ids).toContain('m-authored');
    expect(ids).toContain('m-nullauthor');
    expect(ids).not.toContain('m-other');
    expect(res.body.filtered).toEqual({ byIdentity: true, includesUnowned: true });
  });

  it('an oauth caller still sees rows keyed by their PRE-#346 DISPLAY NAME', async () => {
    // Why resolveUserIdCandidates returns two candidates. A row written before #346
    // carries the display value while the session resolves to the email. This path
    // had never run under oauth.
    const app = await buildOauthApp({ email: EMAIL, name: ME });
    const res = await request(serveInTest(app)).get('/api/v1/models');

    expect(res.status).toBe(200);
    const ids = idsOf(res);
    expect(ids).toContain('m-authored');   // keyed by ME, the display value
    expect(ids).toContain('m-nullauthor');
    expect(ids).not.toContain('m-other');
  });

  it('CONTROL — a session matching nothing still sees the unowned row, not an empty list', async () => {
    // Otherwise the test above could pass for a candidate list that matches anything.
    const app = await buildOauthApp({ email: 'nobody@example.test', name: 'Nobody At All' });
    const res = await request(serveInTest(app)).get('/api/v1/models');

    expect(idsOf(res)).toEqual(['m-nullauthor']);
    expect(res.body.filtered).toEqual({ byIdentity: true, includesUnowned: true });
  });
});
