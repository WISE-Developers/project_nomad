/**
 * Database Module
 *
 * Database initialization using Knex.js for cross-database support.
 * - SAN mode: SQLite with better-sqlite3
 * - ACN mode: PostgreSQL, MySQL, SQL Server, or Oracle
 */

import { Knex } from 'knex';
import {
  initKnex,
  getKnex,
  closeKnex,
  isKnexInitialized,
  testConnection,
} from './knex/index.js';
import { runMigrations } from './migrations/index.js';

/**
 * Initialize the database and run migrations.
 *
 * This is the main entry point for database setup.
 * It initializes Knex and runs any pending migrations.
 */
export async function initDatabase(): Promise<Knex> {
  // Initialize Knex connection
  const knex = initKnex();

  // Test connection
  const connected = await testConnection();
  if (!connected) {
    throw new Error('Failed to connect to database');
  }

  // Run migrations
  const ranMigrations = await runMigrations();
  if (ranMigrations.length > 0) {
    console.log(`[Database] Ran ${ranMigrations.length} migration(s)`);
  }

  return knex;
}

/**
 * Get the Knex instance.
 * Initializes if not already done.
 */
export function getDatabase(): Knex {
  return getKnex();
}

/**
 * Close the database connection.
 */
export async function closeDatabase(): Promise<void> {
  await closeKnex();
}

/**
 * Check if database is initialized.
 */
export function isDatabaseInitialized(): boolean {
  return isKnexInitialized();
}

/**
 * Legacy synchronous init for backwards compatibility.
 * @deprecated Use initDatabase() instead
 */
export function initDatabaseSync(): Knex {
  console.warn('[Database] initDatabaseSync is deprecated, use initDatabase() instead');
  return initKnex();
}
