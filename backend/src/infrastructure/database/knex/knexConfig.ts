/**
 * Knex Configuration Factory
 *
 * Creates Knex configuration based on deployment mode and environment variables.
 * - SAN mode: SQLite with better-sqlite3
 * - ACN mode: PostgreSQL, MySQL, SQL Server, or Oracle based on config
 */

import type { Knex } from 'knex';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { EnvironmentService } from '../../config/EnvironmentService.js';

/**
 * Supported database clients for ACN mode
 */
export type DatabaseClient = 'sqlite3' | 'better-sqlite3' | 'pg' | 'mysql' | 'mysql2' | 'mssql' | 'oracledb';

/**
 * Database configuration from environment variables
 */
export interface DatabaseConfig {
  client: DatabaseClient;
  host?: string;
  port?: number;
  database: string;
  user?: string;
  password?: string;
  ssl?: boolean;
  pool?: {
    min: number;
    max: number;
  };
}

/**
 * Gets the SQLite database path for SAN mode
 */
function getSqlitePath(): string {
  const dataPath = process.env.NOMAD_DATA_PATH || process.env.FIRESTARR_DATASET_PATH || './data';

  // Ensure directory exists
  if (!existsSync(dataPath)) {
    mkdirSync(dataPath, { recursive: true });
  }

  return join(dataPath, 'nomad.db');
}

/**
 * Gets database configuration from environment variables
 */
export function getDatabaseConfig(): DatabaseConfig {
  const env = EnvironmentService.getInstance();
  const deploymentMode = env.getDeploymentMode();

  // SAN mode always uses SQLite
  if (deploymentMode === 'SAN') {
    return {
      client: 'better-sqlite3',
      database: getSqlitePath(),
    };
  }

  // ACN mode: read from environment
  const client = (env.get('NOMAD_DB_CLIENT') || 'pg') as DatabaseClient;

  // ACN mode with SQLite — use the same SQLite path as SAN mode
  if (client === 'sqlite3' || client === 'better-sqlite3') {
    return {
      client: 'better-sqlite3',
      database: env.get('NOMAD_DB_NAME') || getSqlitePath(),
    };
  }

  const host = env.get('NOMAD_DB_HOST');
  const port = env.get('NOMAD_DB_PORT');
  const database = env.get('NOMAD_DB_NAME') || 'nomad';
  const user = env.get('NOMAD_DB_USER');
  const password = env.get('NOMAD_DB_PASSWORD');
  const ssl = env.get('NOMAD_DB_SSL') === 'true';
  const poolMin = parseInt(env.get('NOMAD_DB_POOL_MIN') || '2', 10);
  const poolMax = parseInt(env.get('NOMAD_DB_POOL_MAX') || '10', 10);

  if (!host) {
    throw new Error('NOMAD_DB_HOST is required for ACN mode with non-SQLite database');
  }
  if (!user) {
    throw new Error('NOMAD_DB_USER is required for ACN mode with non-SQLite database');
  }

  return {
    client,
    host,
    port: port ? parseInt(port, 10) : undefined,
    database,
    user,
    password,
    ssl,
    pool: {
      min: poolMin,
      max: poolMax,
    },
  };
}

/**
 * Creates Knex configuration object from database config
 */
export function createKnexConfig(dbConfig?: DatabaseConfig): Knex.Config {
  const config = dbConfig || getDatabaseConfig();

  // SQLite configuration
  if (config.client === 'sqlite3' || config.client === 'better-sqlite3') {
    return {
      client: 'better-sqlite3',
      connection: {
        filename: config.database,
      },
      useNullAsDefault: true,
      // Enable foreign keys for SQLite (better-sqlite3 is synchronous)
      pool: {
        afterCreate: (conn: unknown, done: (err: Error | null, conn: unknown) => void) => {
          try {
            // better-sqlite3 uses synchronous pragma() method
            (conn as { pragma: (sql: string) => void }).pragma('foreign_keys = ON');
            done(null, conn);
          } catch (err) {
            done(err as Error, conn);
          }
        },
      },
    };
  }

  // PostgreSQL configuration
  if (config.client === 'pg') {
    return {
      client: 'pg',
      connection: {
        host: config.host,
        port: config.port || 5432,
        database: config.database,
        user: config.user,
        password: config.password,
        ssl: config.ssl ? { rejectUnauthorized: false } : false,
      },
      pool: config.pool,
    };
  }

  // MySQL configuration
  if (config.client === 'mysql' || config.client === 'mysql2') {
    return {
      client: config.client,
      connection: {
        host: config.host,
        port: config.port || 3306,
        database: config.database,
        user: config.user,
        password: config.password,
        ssl: config.ssl ? {} : undefined,
      },
      pool: config.pool,
    };
  }

  // SQL Server configuration
  if (config.client === 'mssql') {
    return {
      client: 'mssql',
      connection: {
        server: config.host,
        port: config.port || 1433,
        database: config.database,
        user: config.user,
        password: config.password,
        options: {
          encrypt: config.ssl,
          trustServerCertificate: !config.ssl,
        },
      },
      pool: config.pool,
    };
  }

  // Oracle configuration
  if (config.client === 'oracledb') {
    return {
      client: 'oracledb',
      connection: {
        host: config.host,
        port: config.port || 1521,
        database: config.database,
        user: config.user,
        password: config.password,
      },
      pool: config.pool,
    };
  }

  throw new Error(`Unsupported database client: ${config.client}`);
}
