/**
 * #315 — shared ad-hoc layers over HTTP.
 *
 * Papa's design: a **private checkbox** decides storage. Private layers live in
 * `localStorage` and never reach the server, so everything this route touches is
 * shared with everyone on the deployment. There is no `scope` parameter because
 * there is nothing to choose — arriving here IS the choice.
 *
 * **Deletion is creator-only.** Everyone can hide a shared layer from their own
 * map; only its author removes it for others. Papa chose this over
 * anyone-can-delete because *"it disappeared and I do not know why"* is worse
 * during an incident than *"it is wrong and I have hidden it."*
 *
 * ON THE REFUSAL CODE, correcting something I said before writing this:
 *
 * I had assumed a non-creator's DELETE should 404, to avoid revealing whether
 * the layer exists. **That is wrong here.** `GET` returns every shared layer to
 * every caller — existence is already public within the deployment. A 404 would
 * hide nothing a user cannot read one request earlier, while costing them a
 * clear message about why their delete failed. So: **403, saying whose it is.**
 *
 * Hiding existence is right when existence is secret. Here it is published.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const { rows } = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

/**
 * A tiny in-memory stand-in for the repository.
 *
 * Deliberately NOT a mock of the route's own logic: it stores and returns rows
 * and nothing else, so the ownership rule under test lives in the route rather
 * than in the fixture. A stub that enforced the rule would pass whatever the
 * route did.
 */
vi.mock('../../../../infrastructure/database/repositories/KnexAdhocLayerRepository.js', () => ({
  getAdhocLayerRepository: () => ({
    list: vi.fn(async () => [...rows]),
    findById: vi.fn(async (id: string) => rows.find((r) => r.id === id) ?? null),
    create: vi.fn(async (row: Record<string, unknown>) => {
      rows.push(row);
      return row;
    }),
    deleteById: vi.fn(async (id: string) => {
      const index = rows.findIndex((r) => r.id === id);
      if (index >= 0) rows.splice(index, 1);
      return index >= 0;
    }),
  }),
}));

const { default: adhocLayersRouter } = await import('../adhocLayers.js');
const { errorHandler } = await import('../../../middleware/errorHandler.js');

/** `resolveUserId` reads `req.user` in simple mode; this sets it. */
function buildApp(asUser?: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (asUser) (req as express.Request & { user?: string }).user = asUser;
    next();
  });
  app.use('/api/v1', adhocLayersRouter);
  app.use(errorHandler);
  return app;
}

const VALID = {
  name: 'BC Hydrography',
  serviceUrl: 'https://openmaps.gov.bc.ca/geo/pub/wms',
  layerName: 'pub:WHSE_WATER.FWA_RIVERS_POLY',
  wmsVersion: '1.3.0',
};

describe('ad-hoc layers', () => {
  beforeEach(() => {
    rows.length = 0;
  });

  describe('the control: the route answers at all', () => {
    it('lists an empty set without error', async () => {
      const res = await request(buildApp('dylan')).get('/api/v1/adhoc-layers').expect(200);
      expect(res.body.layers).toEqual([]);
    });
  });

  describe('creating', () => {
    it('stores a layer and records who created it', async () => {
      await request(buildApp('dylan'))
        .post('/api/v1/adhoc-layers')
        .send(VALID)
        .expect(201);

      expect(rows).toHaveLength(1);
      expect(rows[0].created_by).toBe('dylan');
      expect(rows[0].name).toBe('BC Hydrography');
      expect(rows[0].id).toBeTruthy();
    });

    it('is visible to a DIFFERENT user — that is what shared means', async () => {
      await request(buildApp('dylan')).post('/api/v1/adhoc-layers').send(VALID).expect(201);

      const res = await request(buildApp('franco')).get('/api/v1/adhoc-layers').expect(200);
      expect(res.body.layers).toHaveLength(1);
      expect(res.body.layers[0].name).toBe('BC Hydrography');
    });

    it('refuses a service URL the SSRF guard rejects', async () => {
      // The guard is already tested on its own; this asserts the route is
      // actually WIRED to it. A guard nothing calls is a guard that does not
      // exist.
      const res = await request(buildApp('dylan'))
        .post('/api/v1/adhoc-layers')
        .send({ ...VALID, serviceUrl: 'http://169.254.169.254/latest/meta-data/' });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/link-local|metadata|private/i);
      expect(rows).toHaveLength(0);
    });

    it('refuses a request missing a required field', async () => {
      const res = await request(buildApp('dylan'))
        .post('/api/v1/adhoc-layers')
        .send({ name: 'nameless' });
      expect(res.status).toBe(400);
      expect(rows).toHaveLength(0);
    });
  });

  describe('deleting — creator only', () => {
    async function createAs(user: string): Promise<string> {
      const res = await request(buildApp(user)).post('/api/v1/adhoc-layers').send(VALID);
      return res.body.layer.id as string;
    }

    it('lets the creator remove their own layer', async () => {
      const id = await createAs('dylan');
      await request(buildApp('dylan')).delete(`/api/v1/adhoc-layers/${id}`).expect(204);
      expect(rows).toHaveLength(0);
    });

    it('REFUSES a different user, and says whose it is', async () => {
      const id = await createAs('dylan');

      const res = await request(buildApp('franco')).delete(`/api/v1/adhoc-layers/${id}`);

      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).toMatch(/dylan/);
      // The layer survives. This is the assertion that matters — a refusal that
      // still deletes is worse than no refusal.
      expect(rows).toHaveLength(1);
    });

    it('404s for a layer that does not exist, distinctly from 403', async () => {
      // Different facts, different codes. "You may not" and "there is nothing
      // here" must not render the same, or a user cannot tell a permissions
      // problem from a stale bookmark.
      const res = await request(buildApp('franco')).delete('/api/v1/adhoc-layers/no-such-id');
      expect(res.status).toBe(404);
    });
  });

  describe('when there is no identity at all (NOMAD_AUTH_MODE=none)', () => {
    it('still creates, attributing the layer to nobody', async () => {
      // One user, no identity. An unattributed row is honest here; refusing to
      // create would break the mode entirely.
      await request(buildApp(undefined)).post('/api/v1/adhoc-layers').send(VALID).expect(201);
      expect(rows[0].created_by).toBeNull();
    });

    it('lets an anonymous caller delete an unattributed layer', async () => {
      // With no identities there is exactly one user, so creator-only cannot
      // mean anything stricter than this. The alternative — nobody can ever
      // delete — would make the feature a one-way door in SAN mode.
      await request(buildApp(undefined)).post('/api/v1/adhoc-layers').send(VALID);
      const id = rows[0].id as string;

      await request(buildApp(undefined)).delete(`/api/v1/adhoc-layers/${id}`).expect(204);
      expect(rows).toHaveLength(0);
    });

    it('does NOT let an anonymous caller delete someone ELSE\'s layer', async () => {
      // A deployment that switched from simple auth to none must not hand
      // everyone's layers to an anonymous caller.
      await request(buildApp('dylan')).post('/api/v1/adhoc-layers').send(VALID);
      const id = rows[0].id as string;

      const res = await request(buildApp(undefined)).delete(`/api/v1/adhoc-layers/${id}`);
      expect(res.status).toBe(403);
      expect(rows).toHaveLength(1);
    });
  });
});

/**
 * The route is mounted.
 *
 * Every test above imports `adhocLayersRouter` DIRECTLY and mounts it on a
 * throwaway app — so all eleven would pass with the router wired into nothing.
 * The feature would be fully tested and completely unreachable.
 *
 * Same shape as the #432 warning that was computed and never emitted, and the
 * `isConnected` the toast never read: a thing that exists and is not consumed.
 * A route nobody mounts is a route that does not exist.
 */
describe('the route is actually reachable', () => {
  it('is mounted in the v1 router index', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const index = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');

    // Both halves: an import with no `router.use` compiles and serves nothing.
    expect(index).toContain("from './adhocLayers.js'");
    expect(index).toMatch(/router\.use\(adhocLayersRouter\)/);
  });
});
