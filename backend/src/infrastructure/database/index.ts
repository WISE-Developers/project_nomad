/**
 * Database Infrastructure
 *
 * Persistence layer with pluggable backends:
 * - SAN mode: SQLite (better-sqlite3)
 * - ACN mode: PostgreSQL (future)
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
  getRepositories,
  resetRepositories,
  type DeploymentMode,
} from './RepositoryProvider.js';

// Legacy function-based repositories (for backward compatibility)
// These will be deprecated in favor of the repository provider
export * from './ModelRepository.js';
export * from './JobRepository.js';
export * from './ResultRepository.js';

// SQLite implementations (direct access if needed)
export * from './sqlite/index.js';
