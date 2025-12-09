/**
 * Knex Result Repository
 *
 * Database-agnostic implementation of IResultRepository using Knex.js.
 * Supports SQLite, PostgreSQL, MySQL, SQL Server, and Oracle.
 */

import { Knex } from 'knex';
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
 * Knex implementation of result repository
 */
export class KnexResultRepository implements IResultRepository {
  private readonly tableName = 'model_results';

  constructor(private knex: Knex) {}

  async save(result: ModelResult): Promise<ModelResult> {
    const filePath = result.metadata.filePath ?? '';
    const metadataWithoutPath = { ...result.metadata };
    delete (metadataWithoutPath as Record<string, unknown>).filePath;

    const data = {
      id: result.id,
      model_id: result.fireModelId,
      name: result.getDisplayName(),
      output_type: result.outputType,
      format: result.format,
      file_path: filePath,
      metadata: Object.keys(metadataWithoutPath).length > 0 ? JSON.stringify(metadataWithoutPath) : null,
      created_at: result.createdAt.toISOString(),
    };

    // Use onConflict().merge() for upsert behavior
    await this.knex(this.tableName)
      .insert(data)
      .onConflict('id')
      .merge();

    return result;
  }

  async update(result: ModelResult): Promise<ModelResult> {
    const filePath = result.metadata.filePath ?? '';
    const metadataWithoutPath = { ...result.metadata };
    delete (metadataWithoutPath as Record<string, unknown>).filePath;

    await this.knex(this.tableName)
      .where({ id: result.id })
      .update({
        name: result.getDisplayName(),
        output_type: result.outputType,
        format: result.format,
        file_path: filePath,
        metadata: Object.keys(metadataWithoutPath).length > 0 ? JSON.stringify(metadataWithoutPath) : null,
      });

    return result;
  }

  async findById(id: ModelResultId): Promise<ModelResult | null> {
    const row = await this.knex(this.tableName)
      .where({ id })
      .first<ResultRow>();

    return row ? rowToResult(row) : null;
  }

  async findByModelId(modelId: FireModelId): Promise<ModelResult[]> {
    const rows = await this.knex(this.tableName)
      .where({ model_id: modelId })
      .orderBy('created_at', 'asc')
      .select<ResultRow[]>('*');

    return rows.map(rowToResult);
  }

  async findAll(): Promise<ModelResult[]> {
    const rows = await this.knex(this.tableName)
      .orderBy('created_at', 'desc')
      .select<ResultRow[]>('*');

    return rows.map(rowToResult);
  }

  async delete(id: ModelResultId): Promise<boolean> {
    const deleted = await this.knex(this.tableName)
      .where({ id })
      .delete();

    return deleted > 0;
  }

  async deleteByModelId(modelId: FireModelId): Promise<number> {
    const result = await this.knex(this.tableName)
      .where({ model_id: modelId })
      .delete();

    return result;
  }

  async exists(id: ModelResultId): Promise<boolean> {
    const row = await this.knex(this.tableName)
      .where({ id })
      .select(this.knex.raw('1'))
      .first();

    return row !== undefined;
  }
}
