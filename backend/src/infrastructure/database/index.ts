/**
 * Database Infrastructure
 *
 * Persistence layer using Knex.js for cross-database support:
 * - SAN mode: SQLite (better-sqlite3)
 * - ACN mode: PostgreSQL, MySQL, SQL Server, Oracle
 *
 * Use the repository provider for database-agnostic access.
 */

// Database initialization
export {
  initDatabase,
  getDatabase,
  closeDatabase,
  isDatabaseInitialized,
} from './Database.js';

// Repository provider (database-agnostic)
export {
  initializeRepositories,
  getModelRepository,
  getJobRepository,
  getResultRepository,
  getNotificationPreferencesRepository,
  getRepositories,
  resetRepositories,
  type DeploymentMode,
} from './RepositoryProvider.js';

// Knex connection management
export {
  initKnex,
  getKnex,
  closeKnex,
  resetKnex,
  isKnexInitialized,
  getDatabaseClient,
  isSqlite,
  testConnection,
  type DatabaseConfig,
  type DatabaseClient,
} from './knex/index.js';

// Knex repositories
export {
  KnexModelRepository,
  KnexJobRepository,
  KnexResultRepository,
  KnexNotificationPreferencesRepository,
} from './knex/index.js';

// Migrations
export {
  runMigrations,
  rollbackMigrations,
  getMigrationStatus,
} from './migrations/index.js';

// Note: Legacy function-based repositories (ModelRepository.ts, JobRepository.ts, ResultRepository.ts)
// and SQLite implementations (sqlite/) are no longer exported.
// Use the Knex repositories via getModelRepository(), getJobRepository(), getResultRepository() instead.
