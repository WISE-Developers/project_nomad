/**
 * Database Module
 *
 * SQLite database for persisting models, jobs, and results.
 * Uses better-sqlite3 for synchronous, simple operations.
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';

let db: Database.Database | null = null;

/**
 * Get the database path from environment or use default
 */
function getDatabasePath(): string {
  const dataPath = process.env.NOMAD_DATA_PATH || process.env.FIRESTARR_DATASET_PATH || './data';

  // Ensure directory exists
  if (!existsSync(dataPath)) {
    mkdirSync(dataPath, { recursive: true });
  }

  return join(dataPath, 'nomad.db');
}

/**
 * Initialize the database and create tables
 */
export function initDatabase(): Database.Database {
  if (db) {
    return db;
  }

  const dbPath = getDatabasePath();
  console.log(`[Database] Initializing SQLite database at: ${dbPath}`);

  db = new Database(dbPath);

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
    -- Fire models
    CREATE TABLE IF NOT EXISTS fire_models (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      engine_type TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Jobs
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      model_id TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      error TEXT,
      FOREIGN KEY (model_id) REFERENCES fire_models(id)
    );

    -- Model results (references to output files)
    CREATE TABLE IF NOT EXISTS model_results (
      id TEXT PRIMARY KEY,
      model_id TEXT NOT NULL,
      name TEXT NOT NULL,
      output_type TEXT NOT NULL,
      format TEXT NOT NULL,
      file_path TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (model_id) REFERENCES fire_models(id)
    );

    -- Create indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_jobs_model_id ON jobs(model_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_results_model_id ON model_results(model_id);
  `);

  console.log('[Database] Tables initialized successfully');

  return db;
}

/**
 * Get the database instance (must call initDatabase first)
 */
export function getDatabase(): Database.Database {
  if (!db) {
    return initDatabase();
  }
  return db;
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    console.log('[Database] Connection closed');
  }
}

/**
 * Check if database is initialized
 */
export function isDatabaseInitialized(): boolean {
  return db !== null;
}
