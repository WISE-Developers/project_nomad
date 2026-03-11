/**
 * Migration Runner
 *
 * Runs database migrations using Knex's built-in migration system.
 * Tracks migration state in knex_migrations and knex_migrations_lock tables.
 */

import { Knex } from 'knex';
import { getKnex, isSqlite } from '../knex/index.js';

// Import migrations
import * as migration001 from './001_create_tables.js';
import * as migration002 from './002_add_user_ownership.js';
import * as migration003 from './003_add_model_config.js';
import * as migration004 from './004_create_settings.js';
import * as migration005 from './005_create_notification_preferences.js';
import * as migration006 from './006_add_notes_column.js';
import * as migration007 from './007_add_output_mode_column.js';

/**
 * Migration definition
 */
interface Migration {
  name: string;
  up: (knex: Knex) => Promise<void>;
  down: (knex: Knex) => Promise<void>;
}

/**
 * List of migrations in order
 */
const migrations: Migration[] = [
  { name: '001_create_tables', ...migration001 },
  { name: '002_add_user_ownership', ...migration002 },
  { name: '003_add_model_config', ...migration003 },
  { name: '004_create_settings', ...migration004 },
  { name: '005_create_notification_preferences', ...migration005 },
  { name: '006_add_notes_column', ...migration006 },
  { name: '007_add_output_mode_column', ...migration007 },
];

/**
 * Ensure migration tracking tables exist
 */
async function ensureMigrationTables(knex: Knex): Promise<void> {
  const hasMigrationsTable = await knex.schema.hasTable('knex_migrations');
  if (!hasMigrationsTable) {
    await knex.schema.createTable('knex_migrations', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.integer('batch').notNullable();
      table.timestamp('migration_time').defaultTo(knex.fn.now());
    });
  }

  const hasLockTable = await knex.schema.hasTable('knex_migrations_lock');
  if (!hasLockTable) {
    await knex.schema.createTable('knex_migrations_lock', (table) => {
      table.integer('index').primary();
      table.integer('is_locked');
    });
    // Initialize lock row
    await knex('knex_migrations_lock').insert({ index: 1, is_locked: 0 });
  }
}

/**
 * Get list of completed migrations
 */
async function getCompletedMigrations(knex: Knex): Promise<string[]> {
  const rows = await knex('knex_migrations')
    .select('name')
    .orderBy('id', 'asc');
  return rows.map((row: { name: string }) => row.name);
}

/**
 * Get the current batch number
 */
async function getCurrentBatch(knex: Knex): Promise<number> {
  const result = await knex('knex_migrations')
    .max('batch as batch')
    .first();
  return (result?.batch || 0) as number;
}

/**
 * Acquire migration lock
 */
async function acquireLock(knex: Knex): Promise<boolean> {
  if (isSqlite()) {
    // SQLite doesn't support row-level locking, so we use a simple approach
    const result = await knex('knex_migrations_lock')
      .where({ index: 1, is_locked: 0 })
      .update({ is_locked: 1 });
    return result > 0;
  }

  // For other databases, use proper row locking
  const result = await knex('knex_migrations_lock')
    .where({ index: 1, is_locked: 0 })
    .update({ is_locked: 1 });
  return result > 0;
}

/**
 * Release migration lock
 */
async function releaseLock(knex: Knex): Promise<void> {
  await knex('knex_migrations_lock')
    .where({ index: 1 })
    .update({ is_locked: 0 });
}

/**
 * Run all pending migrations
 */
export async function runMigrations(): Promise<string[]> {
  const knex = getKnex();
  const ran: string[] = [];

  console.log('[MigrationRunner] Starting migrations');

  await ensureMigrationTables(knex);

  // Acquire lock
  const locked = await acquireLock(knex);
  if (!locked) {
    console.log('[MigrationRunner] Another migration is in progress');
    return ran;
  }

  try {
    const completed = await getCompletedMigrations(knex);
    const pending = migrations.filter((m) => !completed.includes(m.name));

    if (pending.length === 0) {
      console.log('[MigrationRunner] No pending migrations');
      return ran;
    }

    const batch = (await getCurrentBatch(knex)) + 1;
    console.log(`[MigrationRunner] Running ${pending.length} migration(s) in batch ${batch}`);

    for (const migration of pending) {
      console.log(`[MigrationRunner] Running: ${migration.name}`);
      await migration.up(knex);

      await knex('knex_migrations').insert({
        name: migration.name,
        batch,
      });

      ran.push(migration.name);
      console.log(`[MigrationRunner] Completed: ${migration.name}`);
    }

    console.log('[MigrationRunner] All migrations completed');
  } finally {
    await releaseLock(knex);
  }

  return ran;
}

/**
 * Rollback the last batch of migrations
 */
export async function rollbackMigrations(): Promise<string[]> {
  const knex = getKnex();
  const rolledBack: string[] = [];

  console.log('[MigrationRunner] Starting rollback');

  await ensureMigrationTables(knex);

  const locked = await acquireLock(knex);
  if (!locked) {
    console.log('[MigrationRunner] Another migration is in progress');
    return rolledBack;
  }

  try {
    const batch = await getCurrentBatch(knex);
    if (batch === 0) {
      console.log('[MigrationRunner] No migrations to rollback');
      return rolledBack;
    }

    const toRollback = await knex('knex_migrations')
      .where({ batch })
      .orderBy('id', 'desc')
      .select('name');

    console.log(`[MigrationRunner] Rolling back ${toRollback.length} migration(s) from batch ${batch}`);

    for (const row of toRollback) {
      const migration = migrations.find((m) => m.name === row.name);
      if (!migration) {
        console.warn(`[MigrationRunner] Migration not found: ${row.name}`);
        continue;
      }

      console.log(`[MigrationRunner] Rolling back: ${migration.name}`);
      await migration.down(knex);

      await knex('knex_migrations')
        .where({ name: migration.name })
        .delete();

      rolledBack.push(migration.name);
      console.log(`[MigrationRunner] Rolled back: ${migration.name}`);
    }

    console.log('[MigrationRunner] Rollback completed');
  } finally {
    await releaseLock(knex);
  }

  return rolledBack;
}

/**
 * Get migration status
 */
export async function getMigrationStatus(): Promise<{ completed: string[]; pending: string[] }> {
  const knex = getKnex();
  await ensureMigrationTables(knex);

  const completed = await getCompletedMigrations(knex);
  const pending = migrations
    .filter((m) => !completed.includes(m.name))
    .map((m) => m.name);

  return { completed, pending };
}
