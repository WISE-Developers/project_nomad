import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { acnAuthMiddleware } from '../acnAuth.js';

function buildApp() {
  const app = express();
  app.get('/whoami', acnAuthMiddleware, (req, res) => res.json(req.acn?.user));
  return app;
}

function identityRequest(app: express.Express) {
  return request(app)
    .get('/whoami')
    .set('X-Nomad-Agency-Id', 'test')
    .set('X-Nomad-Agency-Key', 'test-key')
    .set('X-Nomad-User-Id', 'subject-123')
    .set('X-Nomad-User-Name', 'Keycloak user')
    .set('X-Nomad-User-Role', 'admin');
}

beforeEach(() => {
  vi.stubEnv('NOMAD_DEPLOYMENT_MODE', 'ACN');
  vi.stubEnv('NOMAD_AGENCY_KEY_TEST', 'test-key');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('ACN optional display-name header', () => {
  it('keeps the stable identity and exposes the separate display value', async () => {
    const response = await identityRequest(buildApp())
      .set('X-Nomad-User-Display-Name', 'person@example.test')
      .expect(200);

    expect(response.body).toEqual({
      id: 'subject-123',
      name: 'Keycloak user',
      displayName: 'person@example.test',
      role: 'admin',
    });
  });

  it('does not require the display-name header', async () => {
    const response = await identityRequest(buildApp()).expect(200);

    expect(response.body).toEqual({
      id: 'subject-123',
      name: 'Keycloak user',
      role: 'admin',
    });
  });
});
