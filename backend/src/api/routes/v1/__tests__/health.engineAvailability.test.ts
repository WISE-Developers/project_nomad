/**
 * `GET /health` engine availability (#513).
 *
 * RED FIRST. The route passed the string literals `'FireSTARR'` and `'WISE'` to
 * `isEngineAvailable`, while `EngineType`'s VALUES are `'firestarr'` and `'wise'`
 * (`FireModel.ts:23-24`). The registry is keyed by the enum, so the lookup missed and the
 * endpoint reported every engine unavailable while execution worked fine.
 *
 * WHY THE MOCK MIRRORS THE REGISTRY INSTEAD OF RETURNING `true`.
 * A stub that returns `true` for any argument passes whether or not the caller sends the
 * right one, which is precisely the defect this file exists to catch. So the fake resolves
 * against the real `EngineType` values, exactly as `ENGINE_EXEC_REGISTRY` does — an
 * unrecognised key yields `false`, the same way the production registry yields `undefined`
 * and the service returns `false`.
 *
 * It also records every argument it received, because "the response says available" and
 * "the route asked the right question" are two different assertions and only the second
 * one survives somebody later changing the response shape.
 *
 * BOTH ENGINES ON PURPOSE. `health.ts:53` passes `'WISE'` and is wrong in exactly the same
 * way as `:52`. A fix applied to one branch of a function is not applied to the other, so
 * both are pinned here rather than only the reported one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ─── Hoisted mocks ──────────────────────────────────────────────
// vi.mock factories are hoisted above top-level consts, so the fake and the record of
// what it received are built inside vi.hoisted — the pattern the sibling route tests use.
const { getModelExecutionService, receivedEngineArgs } = vi.hoisted(() => {
  /** Every argument the route handed to isEngineAvailable, in call order. */
  const receivedEngineArgs: unknown[] = [];

  const isEngineAvailable = vi.fn(async (engineType: unknown) => {
    receivedEngineArgs.push(engineType);
    // Mirrors ENGINE_EXEC_REGISTRY: keyed by EngineType VALUES, nothing else resolves.
    return engineType === 'firestarr' || engineType === 'wise';
  });

  return {
    getModelExecutionService: vi.fn(() => ({ isEngineAvailable })),
    receivedEngineArgs,
  };
});

vi.mock('../../../../infrastructure/services/index.js', () => ({
  getModelExecutionService,
}));

vi.mock('../../../../infrastructure/database/knex/KnexConnection.js', () => ({
  isKnexInitialized: vi.fn(() => false),
  getDatabaseClient: vi.fn(() => null),
  testConnection: vi.fn(async () => true),
}));

vi.mock('../../../../infrastructure/config/appVersion.js', () => ({
  resolveAppVersion: vi.fn(() => '0.0.0-test'),
}));

vi.mock('../../../middleware/authMode.js', () => ({
  resolveAuthMode: vi.fn(() => 'none'),
}));

import healthRouter from '../health.js';
import { EngineType } from '../../../../domain/entities/index.js';
import { serveOnce } from '../../../../test/sharedServer.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', healthRouter);
  return app;
}

// ONE listening server for the whole file (#480). The app is identical in every test here,
// so `serveOnce` is the right member of the sharedServer family — building an app per
// request is what the noPerRequestServer guard forbids, and it caught this file first time.
const api = serveOnce(buildApp);

describe('#513 GET /health engine availability', () => {
  beforeEach(() => {
    receivedEngineArgs.length = 0;
  });

  it('reports FireSTARR as available when the execution service can run it', async () => {
    const res = await request(api()).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body.checks.engines.FireSTARR.available).toBe(true);
  });

  it('reports WISE as available too — the same defect sits on the second call site', async () => {
    const res = await request(api()).get('/api/v1/health');

    expect(res.body.checks.engines.WISE.available).toBe(true);
  });

  it('asks using EngineType values, not capitalised display names', async () => {
    await request(api()).get('/api/v1/health');

    // The assertion that survives a response-shape change: what did the route actually ask?
    expect(receivedEngineArgs).toEqual([EngineType.FireSTARR, EngineType.WISE]);

    // And state the trap explicitly, so a regression reads clearly in the failure output.
    expect(receivedEngineArgs).not.toContain('FireSTARR');
    expect(receivedEngineArgs).not.toContain('WISE');
  });

  it('control: an unrecognised engine key resolves to false, so the fake can fail', async () => {
    // Proves the mock is capable of returning false. Without this, a green suite above
    // could mean "the registry mirror always says true" rather than "the caller is correct".
    const svc = getModelExecutionService();
    await expect(svc.isEngineAvailable('FireSTARR')).resolves.toBe(false);
    await expect(svc.isEngineAvailable(EngineType.FireSTARR)).resolves.toBe(true);
  });
});
