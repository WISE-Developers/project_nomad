/**
 * Repository Provider
 *
 * Factory for creating repository instances using Knex.js.
 * Supports SQLite (SAN mode) and PostgreSQL/MySQL/etc (ACN mode).
 */

import { IModelRepository, IJobRepository, IResultRepository } from '../../application/interfaces/index.js';
import { INotificationPreferencesRepository } from '../../application/interfaces/INotificationPreferencesRepository.js';
import { getKnex, getDatabaseClient } from './knex/index.js';
import { KnexModelRepository, KnexJobRepository, KnexResultRepository, KnexNotificationPreferencesRepository } from './knex/index.js';

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
  notificationPreferences: INotificationPreferencesRepository;
}

// Singleton instances
let repositories: Repositories | null = null;
let currentClient: string | null = null;

/**
 * Initializes repositories using Knex.
 * Knex automatically handles the database dialect based on configuration.
 */
export function initializeRepositories(): Repositories {
  const knex = getKnex();
  const client = getDatabaseClient();

  // If already initialized with same client, return existing
  if (repositories && currentClient === client) {
    return repositories;
  }

  console.log(`[RepositoryProvider] Initializing Knex repositories (${client})`);

  repositories = {
    model: new KnexModelRepository(knex),
    job: new KnexJobRepository(knex),
    result: new KnexResultRepository(knex),
    notificationPreferences: new KnexNotificationPreferencesRepository(knex),
  };

  currentClient = client;
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
 * Gets the notification preferences repository instance
 */
export function getNotificationPreferencesRepository(): INotificationPreferencesRepository {
  if (!repositories) {
    initializeRepositories();
  }
  return repositories!.notificationPreferences;
}

/**
 * Resets repositories (useful for testing)
 */
export function resetRepositories(): void {
  repositories = null;
  currentClient = null;
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
