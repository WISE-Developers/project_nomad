/**
 * /api/v1/info MUST report the auth mode (#474).
 *
 * THE BUG THIS EXISTS FOR, found in production on 2026-10-25. The frontend reads
 * `import.meta.env.VITE_AUTH_MODE`, which Vite inlines at BUILD time. Once CI
 * started publishing one image for every site (#465), that constant carried the
 * CI default — `simple` — to a demo whose backend runs `oauth`. The splash
 * offered "Enter your name to continue" while the server had Google and GitHub
 * initialised. Runtime environment cannot change a compiled bundle.
 *
 * The backend already knows the answer: `resolveAuthMode()` reads
 * NOMAD_AUTH_MODE and the startup log announces it. It simply never told the
 * client. Publishing it here is what lets one image serve every site.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import healthRouter from '../routes/v1/health.js';

describe('GET /api/v1/info — auth mode (#474)', () => {
  let app: express.Application;
  const original = process.env.NOMAD_AUTH_MODE;

  beforeAll(() => {
    process.env.NOMAD_VERSION = '0.0.0-test';
    app = express();
    app.use(express.json());
    app.use('/api/v1', healthRouter);
  });

  afterEach(() => {
    if (original === undefined) delete process.env.NOMAD_AUTH_MODE;
    else process.env.NOMAD_AUTH_MODE = original;
  });

  it('reports the configured auth mode', async () => {
    process.env.NOMAD_AUTH_MODE = 'oauth';
    const response = await request(app).get('/api/v1/info');
    expect(response.status).toBe(200);
    expect(response.body.authMode).toBe('oauth');
  });

  it('reports simple when that is what is configured', async () => {
    process.env.NOMAD_AUTH_MODE = 'simple';
    const response = await request(app).get('/api/v1/info');
    expect(response.body.authMode).toBe('simple');
  });

  // The whole point is that the SERVER decides. A response that omits the field
  // leaves the client inferring it from a baked constant, which is the defect.
  it('always includes the field, whatever the mode', async () => {
    delete process.env.NOMAD_AUTH_MODE;
    const response = await request(app).get('/api/v1/info');
    expect(response.body).toHaveProperty('authMode');
    expect(['none', 'simple', 'oauth']).toContain(response.body.authMode);
  });
});
