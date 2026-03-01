/**
 * Settings API Tests
 *
 * Tests for GET/PUT/DELETE /api/v1/settings/:key
 * Covers DB storage, env var defaults, and UI override behavior.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// ---- In-memory store shared across mock instances ----
const _store = new Map<string, string>();

vi.mock('../../infrastructure/database/repositories/KnexSettingsRepository.js', () => {
  return {
    KnexSettingsRepository: vi.fn().mockImplementation(() => ({
      get: vi.fn().mockImplementation((key: string) => {
        return Promise.resolve(_store.get(key) ?? null);
      }),
      getWithSource: vi.fn().mockImplementation((key: string) => {
        const dbValue = _store.get(key);
        if (dbValue !== undefined) {
          return Promise.resolve({ value: dbValue, source: 'db' });
        }
        const envValue = process.env[key];
        if (envValue !== undefined) {
          return Promise.resolve({ value: envValue, source: 'env' });
        }
        return Promise.resolve(null);
      }),
      set: vi.fn().mockImplementation((key: string, value: string) => {
        _store.set(key, value);
        return Promise.resolve();
      }),
      delete: vi.fn().mockImplementation((key: string) => {
        const existed = _store.has(key);
        _store.delete(key);
        return Promise.resolve(existed);
      }),
    })),
  };
});

import settingsRouter from '../routes/v1/settings.js';

describe('Settings API', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1', settingsRouter);
  });

  afterEach(() => {
    _store.clear();
    delete process.env['TEST_SETTINGS_KEY'];
  });

  describe('GET /api/v1/settings/:key', () => {
    it('returns 404 for unknown key', async () => {
      const response = await request(app).get('/api/v1/settings/UNKNOWN_KEY_XYZ');
      expect(response.status).toBe(404);
    });

    it('returns stored value after PUT', async () => {
      await request(app)
        .put('/api/v1/settings/MY_TEST_KEY')
        .send({ value: 'hello-world' });

      const response = await request(app).get('/api/v1/settings/MY_TEST_KEY');
      expect(response.status).toBe(200);
      expect(response.body.key).toBe('MY_TEST_KEY');
      expect(response.body.value).toBe('hello-world');
    });

    it('env var provides default when no UI setting', async () => {
      process.env['TEST_SETTINGS_KEY'] = 'env-default-value';

      const response = await request(app).get('/api/v1/settings/TEST_SETTINGS_KEY');
      expect(response.status).toBe(200);
      expect(response.body.value).toBe('env-default-value');
      expect(response.body.source).toBe('env');
    });

    it('UI setting overrides env var', async () => {
      process.env['TEST_SETTINGS_KEY'] = 'env-default-value';

      await request(app)
        .put('/api/v1/settings/TEST_SETTINGS_KEY')
        .send({ value: 'ui-override-value' });

      const response = await request(app).get('/api/v1/settings/TEST_SETTINGS_KEY');
      expect(response.status).toBe(200);
      expect(response.body.value).toBe('ui-override-value');
      expect(response.body.source).toBe('db');
    });
  });

  describe('PUT /api/v1/settings/:key', () => {
    it('sets a value and returns 200', async () => {
      const response = await request(app)
        .put('/api/v1/settings/CFS_FIRESTARR_AUTHKEY')
        .send({ value: 'test-key-123' });

      expect(response.status).toBe(200);
      expect(response.body.key).toBe('CFS_FIRESTARR_AUTHKEY');
    });

    it('returns 400 when value is missing', async () => {
      const response = await request(app)
        .put('/api/v1/settings/CFS_FIRESTARR_AUTHKEY')
        .send({});

      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /api/v1/settings/:key', () => {
    it('removes UI override and returns 200', async () => {
      await request(app)
        .put('/api/v1/settings/DELETE_TEST_KEY')
        .send({ value: 'to-be-deleted' });

      const deleteResponse = await request(app).delete('/api/v1/settings/DELETE_TEST_KEY');
      expect(deleteResponse.status).toBe(200);
    });
  });
});
