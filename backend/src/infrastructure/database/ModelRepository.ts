/**
 * Model Repository
 *
 * SQLite persistence for FireModel entities.
 */

import { getDatabase } from './Database.js';
import {
  FireModel,
  FireModelId,
  createFireModelId,
  EngineType,
  ModelStatus,
} from '../../domain/entities/FireModel.js';

interface ModelRow {
  id: string;
  name: string;
  engine_type: string;
  status: string;
  created_at: string;
  updated_at: string;
}

/**
 * Converts a database row to a FireModel entity
 */
function rowToModel(row: ModelRow): FireModel {
  return new FireModel({
    id: createFireModelId(row.id),
    name: row.name,
    engineType: row.engine_type as EngineType,
    status: row.status as ModelStatus,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });
}

/**
 * Save a new model to the database
 */
export function saveModel(model: FireModel): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO fire_models (id, name, engine_type, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    model.id,
    model.name,
    model.engineType,
    model.status,
    model.createdAt.toISOString(),
    model.updatedAt.toISOString()
  );
}

/**
 * Update an existing model
 */
export function updateModel(model: FireModel): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    UPDATE fire_models
    SET name = ?, engine_type = ?, status = ?, updated_at = ?
    WHERE id = ?
  `);

  stmt.run(
    model.name,
    model.engineType,
    model.status,
    model.updatedAt.toISOString(),
    model.id
  );
}

/**
 * Find a model by ID
 */
export function findModelById(id: FireModelId): FireModel | null {
  const db = getDatabase();
  const stmt = db.prepare(`SELECT * FROM fire_models WHERE id = ?`);
  const row = stmt.get(id) as ModelRow | undefined;

  return row ? rowToModel(row) : null;
}

/**
 * Get all models
 */
export function findAllModels(): FireModel[] {
  const db = getDatabase();
  const stmt = db.prepare(`SELECT * FROM fire_models ORDER BY created_at DESC`);
  const rows = stmt.all() as ModelRow[];

  return rows.map(rowToModel);
}

/**
 * Find models by status
 */
export function findModelsByStatus(status: ModelStatus): FireModel[] {
  const db = getDatabase();
  const stmt = db.prepare(`SELECT * FROM fire_models WHERE status = ? ORDER BY created_at DESC`);
  const rows = stmt.all(status) as ModelRow[];

  return rows.map(rowToModel);
}

/**
 * Delete a model by ID
 */
export function deleteModel(id: FireModelId): boolean {
  const db = getDatabase();
  const stmt = db.prepare(`DELETE FROM fire_models WHERE id = ?`);
  const result = stmt.run(id);

  return result.changes > 0;
}

/**
 * Check if a model exists
 */
export function modelExists(id: FireModelId): boolean {
  const db = getDatabase();
  const stmt = db.prepare(`SELECT 1 FROM fire_models WHERE id = ?`);
  const row = stmt.get(id);

  return row !== undefined;
}
