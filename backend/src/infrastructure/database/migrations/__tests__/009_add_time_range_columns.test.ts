/**
 * Migration 009 — `fire_models` gains the simulated time range (#482).
 *
 * The column has to exist before the repository can persist anything, and the
 * 26 legacy rows measured on the real sim dirs must survive the migration with
 * NULLs rather than invented values. Both are asserted here.
 *
 * Shape follows `005_create_notification_preferences.test.ts`: in-memory
 * better-sqlite3, `up`/`down` called directly rather than through the runner,
 * so a failure names the migration instead of the runner.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import knex, { Knex } from 'knex';
import { up as createTables } from '../001_create_tables.js';
import { up, down } from '../009_add_time_range_columns.js';

async function createInMemoryDb(): Promise<Knex> {
  return knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
}

describe('009_add_time_range_columns migration', () => {
  let db: Knex;

  beforeEach(async () => {
    db = await createInMemoryDb();
    await createTables(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe('the controls', () => {
    it('starts from a fire_models table that does NOT have the columns', async () => {
      // Without this, every assertion below could be passing against a table
      // that already carried them, and the migration would be untested.
      expect(await db.schema.hasTable('fire_models')).toBe(true);
      expect(await db.schema.hasColumn('fire_models', 'time_range_start')).toBe(false);
      expect(await db.schema.hasColumn('fire_models', 'time_range_end')).toBe(false);
    });
  });

  it('up() adds time_range_start and time_range_end', async () => {
    await up(db);

    expect(await db.schema.hasColumn('fire_models', 'time_range_start')).toBe(true);
    expect(await db.schema.hasColumn('fire_models', 'time_range_end')).toBe(true);
  });

  it('up() is idempotent — running twice does not throw', async () => {
    await up(db);
    await expect(up(db)).resolves.toBeUndefined();
  });

  it('leaves the 26 legacy rows NULL rather than inventing a range', async () => {
    // The ruling on #482, enforced at the schema. A row that predates the
    // column reads NULL, which the repository turns into `undefined`, which
    // every surface renders as unknown. A DEFAULT here — of today, of the
    // current year, of anything — would make the lie permanent and
    // indistinguishable from a real recorded value.
    await db('fire_models').insert({
      id: 'legacy-march-2026',
      name: 'Run that predates the field',
      engine_type: 'firestarr',
      status: 'completed',
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
    });

    await up(db);

    const row = await db('fire_models').where({ id: 'legacy-march-2026' }).first();
    expect(row.time_range_start).toBeNull();
    expect(row.time_range_end).toBeNull();
  });

  it('accepts ISO strings and returns them unchanged', async () => {
    await up(db);

    await db('fire_models').insert({
      id: 'new-run',
      name: 'Run after the field exists',
      engine_type: 'firestarr',
      status: 'queued',
      created_at: '2026-10-30T00:00:00.000Z',
      updated_at: '2026-10-30T00:00:00.000Z',
      time_range_start: '2023-06-19T12:00:00.000Z',
      time_range_end: '2023-06-22T12:00:00.000Z',
    });

    const row = await db('fire_models').where({ id: 'new-run' }).first();
    expect(row.time_range_start).toBe('2023-06-19T12:00:00.000Z');
    expect(row.time_range_end).toBe('2023-06-22T12:00:00.000Z');
  });

  it('down() removes the columns', async () => {
    await up(db);
    await down(db);

    expect(await db.schema.hasColumn('fire_models', 'time_range_start')).toBe(false);
    expect(await db.schema.hasColumn('fire_models', 'time_range_end')).toBe(false);
  });

  it('down() is idempotent — running it without up() does not throw', async () => {
    await expect(down(db)).resolves.toBeUndefined();
  });
});
