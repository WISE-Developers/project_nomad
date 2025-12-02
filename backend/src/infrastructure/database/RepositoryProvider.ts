/**
 * Repository Provider
 *
 * Factory for creating repository instances based on deployment mode.
 * SAN mode uses SQLite, ACN mode would use PostgreSQL.
 */

import { IModelRepository, IJobRepository, IResultRepository } from '../../application/interfaces/index.js';
import { getDatabase } from './Database.js';
import { SqliteModelRepository, SqliteJobRepository, SqliteResultRepository } from './sqlite/index.js';

/**
 * Deployment mode determines which database backend to use
 */
export type DeploymentMode = 'SAN' | 'ACN';

/**
 * Repository instances container
 */
interface Repositories {
  model: IModelRepository;
  job: IJobRepository;
  result: IResultRepository;
}

// Singleton instances
let repositories: Repositories | null = null;
let currentMode: DeploymentMode | null = null;

/**
 * Gets the current deployment mode from environment
 */
function getDeploymentMode(): DeploymentMode {
  const mode = process.env.NOMAD_DEPLOYMENT_MODE;
  if (mode === 'ACN') {
    return 'ACN';
  }
  return 'SAN'; // Default to SAN mode
}

/**
 * Initializes repositories for the current deployment mode.
 * Must be called after database initialization.
 */
export function initializeRepositories(): Repositories {
  const mode = getDeploymentMode();

  if (repositories && currentMode === mode) {
    return repositories;
  }

  console.log(`[RepositoryProvider] Initializing ${mode} repositories`);

  if (mode === 'SAN') {
    const db = getDatabase();
    repositories = {
      model: new SqliteModelRepository(db),
      job: new SqliteJobRepository(db),
      result: new SqliteResultRepository(db),
    };
  } else {
    // ACN mode - PostgreSQL implementation would go here
    // For now, fall back to SQLite with a warning
    console.warn('[RepositoryProvider] ACN mode not yet implemented, falling back to SQLite');
    const db = getDatabase();
    repositories = {
      model: new SqliteModelRepository(db),
      job: new SqliteJobRepository(db),
      result: new SqliteResultRepository(db),
    };
  }

  currentMode = mode;
  return repositories;
}

/**
 * Gets the model repository instance
 */
export function getModelRepository(): IModelRepository {
  if (!repositories) {
    initializeRepositories();
  }
  return repositories!.model;
}

/**
 * Gets the job repository instance
 */
export function getJobRepository(): IJobRepository {
  if (!repositories) {
    initializeRepositories();
  }
  return repositories!.job;
}

/**
 * Gets the result repository instance
 */
export function getResultRepository(): IResultRepository {
  if (!repositories) {
    initializeRepositories();
  }
  return repositories!.result;
}

/**
 * Resets repositories (useful for testing)
 */
export function resetRepositories(): void {
  repositories = null;
  currentMode = null;
}

/**
 * Gets all repositories
 */
export function getRepositories(): Repositories {
  if (!repositories) {
    initializeRepositories();
  }
  return repositories!;
}
