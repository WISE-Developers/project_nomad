/**
 * SQLite Result Repository
 *
 * SQLite implementation of IResultRepository for SAN mode.
 */

import Database from 'better-sqlite3';
import {
  ModelResult,
  ModelResultId,
  createModelResultId,
  OutputType,
  OutputFormat,
  ResultMetadata,
  FireModelId,
} from '../../../domain/entities/index.js';
import { createFireModelId } from '../../../domain/entities/FireModel.js';
import { IResultRepository } from '../../../application/interfaces/index.js';

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
  const parsedMetadata = row.metadata ? JSON.parse(row.metadata) : {};

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
 * SQLite implementation of result repository
 */
export class SqliteResultRepository implements IResultRepository {
  constructor(private db: Database.Database) {}

  async save(result: ModelResult): Promise<ModelResult> {
    // Use INSERT OR REPLACE for upsert behavior
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO model_results (id, model_id, name, output_type, format, file_path, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const filePath = result.metadata.filePath ?? '';
    const metadataWithoutPath = { ...result.metadata };
    delete (metadataWithoutPath as Record<string, unknown>).filePath;

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

    return result;
  }

  async update(result: ModelResult): Promise<ModelResult> {
    const stmt = this.db.prepare(`
      UPDATE model_results
      SET name = ?, output_type = ?, format = ?, file_path = ?, metadata = ?
      WHERE id = ?
    `);

    const filePath = result.metadata.filePath ?? '';
    const metadataWithoutPath = { ...result.metadata };
    delete (metadataWithoutPath as Record<string, unknown>).filePath;

    stmt.run(
      result.getDisplayName(),
      result.outputType,
      result.format,
      filePath,
      Object.keys(metadataWithoutPath).length > 0 ? JSON.stringify(metadataWithoutPath) : null,
      result.id
    );

    return result;
  }

  async findById(id: ModelResultId): Promise<ModelResult | null> {
    const stmt = this.db.prepare(`SELECT * FROM model_results WHERE id = ?`);
    const row = stmt.get(id) as ResultRow | undefined;
    return row ? rowToResult(row) : null;
  }

  async findByModelId(modelId: FireModelId): Promise<ModelResult[]> {
    const stmt = this.db.prepare(`SELECT * FROM model_results WHERE model_id = ? ORDER BY created_at ASC`);
    const rows = stmt.all(modelId) as ResultRow[];
    return rows.map(rowToResult);
  }

  async findAll(): Promise<ModelResult[]> {
    const stmt = this.db.prepare(`SELECT * FROM model_results ORDER BY created_at DESC`);
    const rows = stmt.all() as ResultRow[];
    return rows.map(rowToResult);
  }

  async delete(id: ModelResultId): Promise<boolean> {
    const stmt = this.db.prepare(`DELETE FROM model_results WHERE id = ?`);
    const result = stmt.run(id);
    return result.changes > 0;
  }

  async deleteByModelId(modelId: FireModelId): Promise<number> {
    const stmt = this.db.prepare(`DELETE FROM model_results WHERE model_id = ?`);
    const result = stmt.run(modelId);
    return result.changes;
  }

  async exists(id: ModelResultId): Promise<boolean> {
    const stmt = this.db.prepare(`SELECT 1 FROM model_results WHERE id = ?`);
    const row = stmt.get(id);
    return row !== undefined;
  }
}
