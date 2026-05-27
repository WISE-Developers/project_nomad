/**
 * Tests for GET /api/v1/splash (refs #275).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import splashRouter from '../splash.js';

function buildApp() {
  const app = express();
  app.use('/api/v1', splashRouter);
  return app;
}

const VALID = [
  '---',
  'version: 1.2.3',
  'title: Hello Nomad',
  '---',
  '',
  '## Body heading',
  '- bullet',
  '',
].join('\n');

describe('GET /api/v1/splash', () => {
  let tmpDir: string;
  let splashFile: string;
  const origEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'splash-test-'));
    splashFile = path.join(tmpDir, 'splash.md');
    delete process.env.NOMAD_SPLASH_ENABLED;
    delete process.env.NOMAD_SPLASH_PATH;
    delete process.env.NOMAD_DATA_PATH;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.env = { ...origEnv };
  });

  it('returns enabled splash payload when env=true and file is valid', async () => {
    fs.writeFileSync(splashFile, VALID);
    process.env.NOMAD_SPLASH_ENABLED = 'true';
    process.env.NOMAD_SPLASH_PATH = splashFile;

    const res = await request(buildApp()).get('/api/v1/splash');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      enabled: true,
      version: '1.2.3',
      title: 'Hello Nomad',
      body: expect.stringContaining('## Body heading'),
      dismissable: true,
    });
  });

  it('returns { enabled: false } when NOMAD_SPLASH_ENABLED is unset', async () => {
    fs.writeFileSync(splashFile, VALID);
    process.env.NOMAD_SPLASH_PATH = splashFile;

    const res = await request(buildApp()).get('/api/v1/splash');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false });
  });

  it('returns { enabled: false } when NOMAD_SPLASH_ENABLED is not exactly "true"', async () => {
    fs.writeFileSync(splashFile, VALID);
    process.env.NOMAD_SPLASH_ENABLED = 'false';
    process.env.NOMAD_SPLASH_PATH = splashFile;

    const res = await request(buildApp()).get('/api/v1/splash');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false });

    process.env.NOMAD_SPLASH_ENABLED = '1';
    const res2 = await request(buildApp()).get('/api/v1/splash');
    expect(res2.body).toEqual({ enabled: false });
  });

  it('returns { enabled: false } when file does not exist (no 500)', async () => {
    process.env.NOMAD_SPLASH_ENABLED = 'true';
    process.env.NOMAD_SPLASH_PATH = path.join(tmpDir, 'nonexistent.md');

    const res = await request(buildApp()).get('/api/v1/splash');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false });
  });

  it('returns { enabled: false } when frontmatter is malformed', async () => {
    fs.writeFileSync(splashFile, '# no frontmatter here, just body');
    process.env.NOMAD_SPLASH_ENABLED = 'true';
    process.env.NOMAD_SPLASH_PATH = splashFile;

    const res = await request(buildApp()).get('/api/v1/splash');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false });
  });

  it('reads file fresh on each request (no caching)', async () => {
    fs.writeFileSync(splashFile, VALID);
    process.env.NOMAD_SPLASH_ENABLED = 'true';
    process.env.NOMAD_SPLASH_PATH = splashFile;

    const app = buildApp();
    const r1 = await request(app).get('/api/v1/splash');
    expect(r1.body.version).toBe('1.2.3');

    const updated = VALID.replace('1.2.3', '2.0.0');
    fs.writeFileSync(splashFile, updated);

    const r2 = await request(app).get('/api/v1/splash');
    expect(r2.body.version).toBe('2.0.0');
  });
});
