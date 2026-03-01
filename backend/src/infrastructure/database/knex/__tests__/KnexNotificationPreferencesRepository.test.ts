/**
 * KnexNotificationPreferencesRepository — Unit Tests
 *
 * Uses in-memory SQLite to test repository behaviour without side effects.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import knex, { Knex } from 'knex';
import { up, DEFAULT_EVENT_TYPES } from '../../migrations/005_create_notification_preferences.js';
import { KnexNotificationPreferencesRepository } from '../KnexNotificationPreferencesRepository.js';

// ─── Helpers ─────────────────────────────────────────────────────

async function createInMemoryDb(): Promise<Knex> {
  const db = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  await up(db);
  return db;
}

// ─── Tests ────────────────────────────────────────────────────────

describe('KnexNotificationPreferencesRepository', () => {
  let db: Knex;
  let repo: KnexNotificationPreferencesRepository;

  beforeEach(async () => {
    db = await createInMemoryDb();
    repo = new KnexNotificationPreferencesRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  // ─── getByUserId ────────────────────────────────────────────────

  describe('getByUserId', () => {
    it('returns all default event types for a new user', async () => {
      const prefs = await repo.getByUserId('user-new');

      expect(prefs).toHaveLength(DEFAULT_EVENT_TYPES.length);

      const eventTypes = prefs.map((p) => p.eventType);
      for (const evt of DEFAULT_EVENT_TYPES) {
        expect(eventTypes).toContain(evt);
      }
    });

    it('returns defaults with toast_enabled=true and browser_enabled=false', async () => {
      const prefs = await repo.getByUserId('user-default');

      for (const pref of prefs) {
        expect(pref.toastEnabled).toBe(true);
        expect(pref.browserEnabled).toBe(false);
        expect(pref.userId).toBe('user-default');
      }
    });

    it('returns stored preferences when they exist', async () => {
      await repo.save({
        userId: 'user-stored',
        eventType: 'model_completed',
        toastEnabled: false,
        browserEnabled: true,
      });

      const prefs = await repo.getByUserId('user-stored');
      const completedPref = prefs.find((p) => p.eventType === 'model_completed');

      expect(completedPref).toBeDefined();
      expect(completedPref!.toastEnabled).toBe(false);
      expect(completedPref!.browserEnabled).toBe(true);
    });

    it('mixes stored and default preferences correctly', async () => {
      await repo.save({
        userId: 'user-mixed',
        eventType: 'model_completed',
        toastEnabled: false,
        browserEnabled: true,
      });

      const prefs = await repo.getByUserId('user-mixed');

      const completedPref = prefs.find((p) => p.eventType === 'model_completed');
      expect(completedPref!.toastEnabled).toBe(false);
      expect(completedPref!.browserEnabled).toBe(true);

      const failedPref = prefs.find((p) => p.eventType === 'model_failed');
      expect(failedPref!.toastEnabled).toBe(true);
      expect(failedPref!.browserEnabled).toBe(false);
    });
  });

  // ─── getByUserAndEvent ──────────────────────────────────────────

  describe('getByUserAndEvent', () => {
    it('returns default when no preference is stored', async () => {
      const pref = await repo.getByUserAndEvent('user-none', 'model_completed');

      expect(pref.userId).toBe('user-none');
      expect(pref.eventType).toBe('model_completed');
      expect(pref.toastEnabled).toBe(true);
      expect(pref.browserEnabled).toBe(false);
    });

    it('returns stored preference', async () => {
      await repo.save({
        userId: 'user-x',
        eventType: 'import_failed',
        toastEnabled: false,
        browserEnabled: true,
      });

      const pref = await repo.getByUserAndEvent('user-x', 'import_failed');

      expect(pref.toastEnabled).toBe(false);
      expect(pref.browserEnabled).toBe(true);
    });
  });

  // ─── save ───────────────────────────────────────────────────────

  describe('save', () => {
    it('persists a new preference', async () => {
      await repo.save({
        userId: 'user-save',
        eventType: 'model_failed',
        toastEnabled: true,
        browserEnabled: true,
      });

      const retrieved = await repo.getByUserAndEvent('user-save', 'model_failed');
      expect(retrieved.toastEnabled).toBe(true);
      expect(retrieved.browserEnabled).toBe(true);
    });

    it('updates an existing preference (upsert)', async () => {
      await repo.save({
        userId: 'user-upsert',
        eventType: 'model_completed',
        toastEnabled: true,
        browserEnabled: false,
      });

      await repo.save({
        userId: 'user-upsert',
        eventType: 'model_completed',
        toastEnabled: false,
        browserEnabled: true,
      });

      const retrieved = await repo.getByUserAndEvent('user-upsert', 'model_completed');
      expect(retrieved.toastEnabled).toBe(false);
      expect(retrieved.browserEnabled).toBe(true);
    });

    it('returns the saved preference', async () => {
      const input = {
        userId: 'user-ret',
        eventType: 'import_completed' as const,
        toastEnabled: true,
        browserEnabled: true,
      };

      const result = await repo.save(input);
      expect(result).toEqual(input);
    });

    it('preferences are isolated per user', async () => {
      await repo.save({ userId: 'user-a', eventType: 'model_completed', toastEnabled: false, browserEnabled: true });
      await repo.save({ userId: 'user-b', eventType: 'model_completed', toastEnabled: true, browserEnabled: false });

      const prefA = await repo.getByUserAndEvent('user-a', 'model_completed');
      const prefB = await repo.getByUserAndEvent('user-b', 'model_completed');

      expect(prefA.browserEnabled).toBe(true);
      expect(prefB.browserEnabled).toBe(false);
    });
  });

  // ─── saveAll ────────────────────────────────────────────────────

  describe('saveAll', () => {
    it('saves multiple preferences at once', async () => {
      const prefs = DEFAULT_EVENT_TYPES.map((eventType) => ({
        userId: 'user-all',
        eventType,
        toastEnabled: true,
        browserEnabled: true,
      }));

      await repo.saveAll(prefs);

      const retrieved = await repo.getByUserId('user-all');
      for (const pref of retrieved) {
        expect(pref.browserEnabled).toBe(true);
      }
    });

    it('returns saved preferences', async () => {
      const prefs = [
        { userId: 'user-ret2', eventType: 'model_completed' as const, toastEnabled: true, browserEnabled: false },
        { userId: 'user-ret2', eventType: 'model_failed' as const, toastEnabled: false, browserEnabled: true },
      ];

      const result = await repo.saveAll(prefs);
      expect(result).toEqual(prefs);
    });

    it('handles empty array gracefully', async () => {
      const result = await repo.saveAll([]);
      expect(result).toEqual([]);
    });
  });
});
