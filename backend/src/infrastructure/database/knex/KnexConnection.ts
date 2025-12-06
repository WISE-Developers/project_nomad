/**
 * Knex Connection Manager
 *
 * Singleton that manages the Knex instance for the application.
 * Handles initialization, connection pooling, and graceful shutdown.
 */

import knex, { Knex } from 'knex';
import { createKnexConfig, getDatabaseConfig, DatabaseConfig } from './knexConfig.js';

let knexInstance: Knex | null = null;
let currentConfig: DatabaseConfig | null = null;

/**
 * Initialize the Knex connection.
 * If already initialized with the same config, returns existing instance.
 */
export function initKnex(config?: DatabaseConfig): Knex {
  const dbConfig = config || getDatabaseConfig();

  // If already initialized with same config, return existing instance
  if (knexInstance && currentConfig && isSameConfig(currentConfig, dbConfig)) {
    return knexInstance;
  }

  // Close existing connection if config changed
  if (knexInstance) {
    console.log('[KnexConnection] Config changed, closing existing connection');
    knexInstance.destroy();
    knexInstance = null;
  }

  const knexConfig = createKnexConfig(dbConfig);
  console.log(`[KnexConnection] Initializing ${dbConfig.client} connection`);

  if (dbConfig.client === 'better-sqlite3' || dbConfig.client === 'sqlite3') {
    console.log(`[KnexConnection] Database file: ${dbConfig.database}`);
  } else {
    console.log(`[KnexConnection] Host: ${dbConfig.host}:${dbConfig.port || 'default'}`);
    console.log(`[KnexConnection] Database: ${dbConfig.database}`);
  }

  knexInstance = knex(knexConfig);
  currentConfig = dbConfig;

  return knexInstance;
}

/**
 * Get the Knex instance (initializes if needed).
 */
export function getKnex(): Knex {
  if (!knexInstance) {
    return initKnex();
  }
  return knexInstance;
}

/**
 * Check if Knex is initialized.
 */
export function isKnexInitialized(): boolean {
  return knexInstance !== null;
}

/**
 * Get the current database client type.
 */
export function getDatabaseClient(): string | null {
  return currentConfig?.client || null;
}

/**
 * Check if using SQLite (SAN mode typically).
 */
export function isSqlite(): boolean {
  const client = currentConfig?.client;
  return client === 'sqlite3' || client === 'better-sqlite3';
}

/**
 * Close the Knex connection gracefully.
 */
export async function closeKnex(): Promise<void> {
  if (knexInstance) {
    console.log('[KnexConnection] Closing connection');
    await knexInstance.destroy();
    knexInstance = null;
    currentConfig = null;
    console.log('[KnexConnection] Connection closed');
  }
}

/**
 * Reset connection (for testing).
 */
export async function resetKnex(): Promise<void> {
  await closeKnex();
}

/**
 * Test the database connection.
 */
export async function testConnection(): Promise<boolean> {
  try {
    const db = getKnex();
    await db.raw('SELECT 1');
    console.log('[KnexConnection] Connection test successful');
    return true;
  } catch (error) {
    console.error('[KnexConnection] Connection test failed:', error);
    return false;
  }
}

/**
 * Compare two database configs for equality.
 */
function isSameConfig(a: DatabaseConfig, b: DatabaseConfig): boolean {
  return (
    a.client === b.client &&
    a.host === b.host &&
    a.port === b.port &&
    a.database === b.database &&
    a.user === b.user &&
    a.password === b.password
  );
}
