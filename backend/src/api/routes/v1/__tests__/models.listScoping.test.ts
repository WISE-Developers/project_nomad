/**
 * CHARACTERIZATION: `GET /models` silently scopes the list by caller identity (#489).
 *
 * A downstream consumer measured, against a deployed instance: no identity header returned
 * 5 models, `X-Nomad-User` present returned 0, both 200. The cause is one line in the
 * handler —
 *
 *   const userIds = resolveUserIdCandidates(req);
 *   const filter = userIds.length > 0 ? { userId: userIds } : {};
 *
 * — so identity resolving at all turns an unfiltered list into a filtered one, and the
 * response carries nothing saying it was filtered.
 *
 * These tests pin that behaviour at the boundary that matters: the FILTER handed to the
 * repository, plus the consequence for rows whose `userId` is null (which is #488 — every
 * model created through a proxy). They DO NOT endorse it. #489's acceptance criteria leave
 * open whether scoping should be the default at all, or opt-in via a query parameter, so
 * no remedy is asserted here. When that is decided, these tests must change deliberately
 * rather than quietly going green on new behaviour.
 *
 * The null-author case is the dangerous one and the reason this file exists: those rows are
 * invisible to every identified caller and visible to every unidentified one, which is the
 * inverse of what an audit-sensitive default should be. An empty list reads as "nothing to
 * see" rather than "nothing of yours".
 */

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

/** Two rows: one authored, one with a null author — the #488 shape. */
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
    id: 'm-nullauthor',
    name: 'legacy run with no recorded author',
    engineType: 'firestarr',
    status: 'draft',
    createdAt: new Date('2026-06-30T00:00:00Z'),
    // userId deliberately absent — this is what every proxied create produced (#488)
  },
];

const { getModelRepository, find } = vi.hoisted(() => {
  /**
   * Applies the filter the way a repository would, so the test shows the CONSEQUENCE of
   * the filter rather than only its shape. A mock that ignored the filter would pass
   * whatever the handler did, which is the failure mode this file is about.
   */
  const find = vi.fn(async (filter: { userId?: string | string[] }) => {
    const rows = (globalThis as { __rows?: Row[] }).__rows ?? [];
    if (!filter || filter.userId === undefined) return { models: rows, total: rows.length };
    const wanted = Array.isArray(filter.userId) ? filter.userId : [filter.userId];
    const matched = rows.filter((r) => r.userId !== undefined && wanted.includes(r.userId));
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

describe('#489 — GET /models scopes silently by caller identity', () => {
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

  it('an UNIDENTIFIED caller gets an unfiltered list, including the null-author row', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/v1/models');

    expect(res.status).toBe(200);
    expect(find).toHaveBeenCalledWith({});
    expect(res.body.models.map((m: { id: string }) => m.id)).toEqual([
      'm-authored',
      'm-nullauthor',
    ]);
  });

  it('an IDENTIFIED caller gets a filtered list, and the null-author row disappears', async () => {
    const app = await buildApp();
    const res = await request(app)
      .get('/api/v1/models')
      .set('x-nomad-user', 'Test Modeller (00000000-0000-4000-8000-000000000000)');

    expect(res.status).toBe(200);

    // The filter is the defect's mechanism: identity present => scoped query.
    const filterUsed = find.mock.calls[0][0];
    expect(filterUsed).not.toEqual({});
    expect(JSON.stringify(filterUsed)).toContain('Test Modeller');

    // And the consequence: the row with no recorded author is gone.
    const ids = res.body.models.map((m: { id: string }) => m.id);
    expect(ids).not.toContain('m-nullauthor');

    // Still 200, and nothing in the payload says the result set was narrowed. This is
    // what makes "no models" and "none of yours" indistinguishable to a caller.
    expect(res.body).not.toHaveProperty('filtered');
  });

  it('an identity matching NOTHING yields an empty list with a 200 and no explanation', async () => {
    const app = await buildApp();
    const res = await request(app)
      .get('/api/v1/models')
      .set('x-nomad-user', 'somebody-with-no-models');

    expect(res.status).toBe(200);
    expect(res.body.models).toEqual([]);
    expect(res.body).not.toHaveProperty('filtered');
  });
});
