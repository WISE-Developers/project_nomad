/**
 * Knex Database Infrastructure
 *
 * Provides database abstraction using Knex.js query builder.
 * Supports SQLite (SAN mode) and PostgreSQL/MySQL/etc (ACN mode).
 */

// Configuration
export {
  createKnexConfig,
  getDatabaseConfig,
  type DatabaseConfig,
  type DatabaseClient,
} from './knexConfig.js';

// Connection management
export {
  initKnex,
  getKnex,
  closeKnex,
  resetKnex,
  isKnexInitialized,
  getDatabaseClient,
  isSqlite,
  testConnection,
} from './KnexConnection.js';

// Repositories
export { KnexModelRepository } from './KnexModelRepository.js';
export { KnexJobRepository } from './KnexJobRepository.js';
export { KnexResultRepository } from './KnexResultRepository.js';
export { KnexNotificationPreferencesRepository } from './KnexNotificationPreferencesRepository.js';
