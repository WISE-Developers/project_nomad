/**
 * Notification Preferences API — Integration Tests
 *
 * Tests GET /api/v1/notifications/preferences and
 * PUT /api/v1/notifications/preferences using an in-memory SQLite database.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import knex, { Knex } from 'knex';
import { up } from '../../infrastructure/database/migrations/005_create_notification_preferences.js';
import { KnexNotificationPreferencesRepository } from '../../infrastructure/database/knex/KnexNotificationPreferencesRepository.js';
import { DEFAULT_EVENT_TYPES } from '../../infrastructure/database/migrations/005_create_notification_preferences.js';
import notificationsRouter from '../routes/v1/notifications.js';

// ─── Helpers ─────────────────────────────────────────────────────

let db: Knex;
let app: express.Application;

async function createInMemoryDb(): Promise<Knex> {
  const database = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  await up(database);
  return database;
}

// ─── Setup ────────────────────────────────────────────────────────

beforeAll(async () => {
  db = await createInMemoryDb();
  const repo = new KnexNotificationPreferencesRepository(db);

  app = express();
  app.use(express.json());
  app.use('/api/v1', notificationsRouter(repo));
});

afterAll(async () => {
  await db.destroy();
});

// ─── Tests ────────────────────────────────────────────────────────

describe('Notification Preferences API', () => {
  const userId = 'test-user-api';

  describe('GET /api/v1/notifications/preferences', () => {
    it('returns 200 with all default event types for an unknown user', async () => {
      const response = await request(app)
        .get('/api/v1/notifications/preferences')
        .set('X-Nomad-User', userId);

      expect(response.status).toBe(200);
      expect(response.body.preferences).toBeDefined();
      expect(Array.isArray(response.body.preferences)).toBe(true);
      expect(response.body.preferences).toHaveLength(DEFAULT_EVENT_TYPES.length);
    });

    it('returns all four default event types', async () => {
      const response = await request(app)
        .get('/api/v1/notifications/preferences')
        .set('X-Nomad-User', 'user-event-types');

      const eventTypes = response.body.preferences.map(
        (p: { eventType: string }) => p.eventType
      );

      for (const evt of DEFAULT_EVENT_TYPES) {
        expect(eventTypes).toContain(evt);
      }
    });

    it('returns toast_enabled=true and browser_enabled=false by default', async () => {
      const response = await request(app)
        .get('/api/v1/notifications/preferences')
        .set('X-Nomad-User', 'user-default-vals');

      for (const pref of response.body.preferences) {
        expect(pref.toastEnabled).toBe(true);
        expect(pref.browserEnabled).toBe(false);
      }
    });

    it('uses anonymous user when no X-Nomad-User header is set', async () => {
      const response = await request(app).get('/api/v1/notifications/preferences');
      expect(response.status).toBe(200);
      expect(response.body.preferences).toBeDefined();
    });
  });

  describe('PUT /api/v1/notifications/preferences', () => {
    it('saves and returns updated preferences', async () => {
      const body = {
        preferences: [
          { eventType: 'model_completed', toastEnabled: false, browserEnabled: true },
          { eventType: 'model_failed', toastEnabled: true, browserEnabled: true },
        ],
      };

      const putResponse = await request(app)
        .put('/api/v1/notifications/preferences')
        .set('X-Nomad-User', 'user-put')
        .send(body);

      expect(putResponse.status).toBe(200);
      expect(putResponse.body.preferences).toBeDefined();

      // Verify GET reflects the saved values
      const getResponse = await request(app)
        .get('/api/v1/notifications/preferences')
        .set('X-Nomad-User', 'user-put');

      const completedPref = getResponse.body.preferences.find(
        (p: { eventType: string }) => p.eventType === 'model_completed'
      );

      expect(completedPref.toastEnabled).toBe(false);
      expect(completedPref.browserEnabled).toBe(true);
    });

    it('returns 400 when preferences array is missing', async () => {
      const response = await request(app)
        .put('/api/v1/notifications/preferences')
        .set('X-Nomad-User', 'user-bad')
        .send({});

      expect(response.status).toBe(400);
    });

    it('returns 400 when preferences is not an array', async () => {
      const response = await request(app)
        .put('/api/v1/notifications/preferences')
        .set('X-Nomad-User', 'user-bad2')
        .send({ preferences: 'bad' });

      expect(response.status).toBe(400);
    });

    it('returns 400 for invalid event type', async () => {
      const response = await request(app)
        .put('/api/v1/notifications/preferences')
        .set('X-Nomad-User', 'user-bad3')
        .send({
          preferences: [
            { eventType: 'not_a_real_event', toastEnabled: true, browserEnabled: false },
          ],
        });

      expect(response.status).toBe(400);
    });

    it('returns 200 for empty preferences array (no-op)', async () => {
      const response = await request(app)
        .put('/api/v1/notifications/preferences')
        .set('X-Nomad-User', 'user-empty')
        .send({ preferences: [] });

      expect(response.status).toBe(200);
    });
  });
});
