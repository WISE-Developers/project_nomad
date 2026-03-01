/**
 * Migration 005 + KnexNotificationPreferencesRepository — Unit Tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import knex, { Knex } from 'knex';
import { up, down } from '../005_create_notification_preferences.js';

// ─── Helpers ─────────────────────────────────────────────────────

async function createInMemoryDb(): Promise<Knex> {
  return knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
}

// ─── Migration Tests ──────────────────────────────────────────────

describe('005_create_notification_preferences migration', () => {
  let db: Knex;

  beforeEach(async () => {
    db = await createInMemoryDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('up() creates notification_preferences table', async () => {
    const beforeUp = await db.schema.hasTable('notification_preferences');
    expect(beforeUp).toBe(false);

    await up(db);

    const afterUp = await db.schema.hasTable('notification_preferences');
    expect(afterUp).toBe(true);
  });

  it('up() is idempotent — running twice does not throw', async () => {
    await up(db);
    await expect(up(db)).resolves.toBeUndefined();
  });

  it('up() creates table with expected columns', async () => {
    await up(db);

    expect(await db.schema.hasColumn('notification_preferences', 'user_id')).toBe(true);
    expect(await db.schema.hasColumn('notification_preferences', 'event_type')).toBe(true);
    expect(await db.schema.hasColumn('notification_preferences', 'toast_enabled')).toBe(true);
    expect(await db.schema.hasColumn('notification_preferences', 'browser_enabled')).toBe(true);
  });

  it('up() enforces composite primary key (user_id, event_type)', async () => {
    await up(db);

    await db('notification_preferences').insert({
      user_id: 'user-1',
      event_type: 'model_completed',
      toast_enabled: 1,
      browser_enabled: 0,
    });

    // Inserting same PK should throw
    await expect(
      db('notification_preferences').insert({
        user_id: 'user-1',
        event_type: 'model_completed',
        toast_enabled: 0,
        browser_enabled: 1,
      })
    ).rejects.toThrow();
  });

  it('up() allows same user_id with different event_types', async () => {
    await up(db);

    await db('notification_preferences').insert({
      user_id: 'user-1',
      event_type: 'model_completed',
      toast_enabled: 1,
      browser_enabled: 0,
    });

    await expect(
      db('notification_preferences').insert({
        user_id: 'user-1',
        event_type: 'model_failed',
        toast_enabled: 1,
        browser_enabled: 0,
      })
    ).resolves.toBeDefined();
  });

  it('up() allows different users with same event_type', async () => {
    await up(db);

    await db('notification_preferences').insert({
      user_id: 'user-1',
      event_type: 'model_completed',
      toast_enabled: 1,
      browser_enabled: 0,
    });

    await expect(
      db('notification_preferences').insert({
        user_id: 'user-2',
        event_type: 'model_completed',
        toast_enabled: 0,
        browser_enabled: 1,
      })
    ).resolves.toBeDefined();
  });

  it('down() drops the notification_preferences table', async () => {
    await up(db);
    await down(db);

    const hasTable = await db.schema.hasTable('notification_preferences');
    expect(hasTable).toBe(false);
  });

  it('down() is safe when table does not exist', async () => {
    await expect(down(db)).resolves.toBeUndefined();
  });
});
