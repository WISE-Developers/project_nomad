/**
 * Result Repository
 *
 * SQLite persistence for ModelResult entities.
 */

import { getDatabase } from './Database.js';
import {
  ModelResult,
  ModelResultId,
  createModelResultId,
  OutputType,
  OutputFormat,
  ResultMetadata,
} from '../../domain/entities/ModelResult.js';
import { createFireModelId, FireModelId } from '../../domain/entities/FireModel.js';

interface ResultRow {
  id: string;
  model_id: string;
  name: string;
  output_type: string;
  format: string;
  file_path: string;
  metadata: string | null;
  created_at: string;
}

/**
 * Converts a database row to a ModelResult entity
 */
function rowToResult(row: ResultRow): ModelResult {
  const parsedMetadata = row.metadata
    ? JSON.parse(row.metadata)
    : {};

  // Create metadata with filePath included
  const metadata: ResultMetadata = {
    ...parsedMetadata,
    filePath: row.file_path,
  };

  return new ModelResult({
    id: createModelResultId(row.id),
    fireModelId: createFireModelId(row.model_id),
    outputType: row.output_type as OutputType,
    format: row.format as OutputFormat,
    metadata,
    createdAt: new Date(row.created_at),
  });
}

/**
 * Save a new result to the database
 */
export function saveResult(result: ModelResult): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO model_results (id, model_id, name, output_type, format, file_path, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const filePath = result.metadata.filePath ?? '';
  const metadataWithoutPath = { ...result.metadata };
  delete metadataWithoutPath.filePath;

  stmt.run(
    result.id,
    result.fireModelId,
    result.getDisplayName(),
    result.outputType,
    result.format,
    filePath,
    Object.keys(metadataWithoutPath).length > 0 ? JSON.stringify(metadataWithoutPath) : null,
    result.createdAt.toISOString()
  );
}

/**
 * Update an existing result
 */
export function updateResult(result: ModelResult): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    UPDATE model_results
    SET name = ?, output_type = ?, format = ?, file_path = ?, metadata = ?
    WHERE id = ?
  `);

  const filePath = result.metadata.filePath ?? '';
  const metadataWithoutPath = { ...result.metadata };
  delete metadataWithoutPath.filePath;

  stmt.run(
    result.getDisplayName(),
    result.outputType,
    result.format,
    filePath,
    Object.keys(metadataWithoutPath).length > 0 ? JSON.stringify(metadataWithoutPath) : null,
    result.id
  );
}

/**
 * Find a result by ID
 */
export function findResultById(id: ModelResultId): ModelResult | null {
  const db = getDatabase();
  const stmt = db.prepare(`SELECT * FROM model_results WHERE id = ?`);
  const row = stmt.get(id) as ResultRow | undefined;

  return row ? rowToResult(row) : null;
}

/**
 * Find results by model ID
 */
export function findResultsByModelId(modelId: FireModelId): ModelResult[] {
  const db = getDatabase();
  const stmt = db.prepare(`SELECT * FROM model_results WHERE model_id = ? ORDER BY created_at ASC`);
  const rows = stmt.all(modelId) as ResultRow[];

  return rows.map(rowToResult);
}

/**
 * Get all results
 */
export function findAllResults(): ModelResult[] {
  const db = getDatabase();
  const stmt = db.prepare(`SELECT * FROM model_results ORDER BY created_at DESC`);
  const rows = stmt.all() as ResultRow[];

  return rows.map(rowToResult);
}

/**
 * Delete a result by ID
 */
export function deleteResult(id: ModelResultId): boolean {
  const db = getDatabase();
  const stmt = db.prepare(`DELETE FROM model_results WHERE id = ?`);
  const result = stmt.run(id);

  return result.changes > 0;
}

/**
 * Delete all results for a model
 */
export function deleteResultsByModelId(modelId: FireModelId): number {
  const db = getDatabase();
  const stmt = db.prepare(`DELETE FROM model_results WHERE model_id = ?`);
  const result = stmt.run(modelId);

  return result.changes;
}

/**
 * Check if a result exists
 */
export function resultExists(id: ModelResultId): boolean {
  const db = getDatabase();
  const stmt = db.prepare(`SELECT 1 FROM model_results WHERE id = ?`);
  const row = stmt.get(id);

  return row !== undefined;
}
