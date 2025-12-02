/**
 * SQLite Model Repository
 *
 * SQLite implementation of IModelRepository for SAN mode.
 */

import Database from 'better-sqlite3';
import {
  FireModel,
  FireModelId,
  createFireModelId,
  EngineType,
  ModelStatus,
  ModelResult,
  ModelResultId,
} from '../../../domain/entities/index.js';
import { NotFoundError } from '../../../domain/errors/index.js';
import {
  IModelRepository,
  ModelFilter,
  SpatialModelFilter,
  ModelQueryOptions,
  ModelQueryResult,
} from '../../../application/interfaces/index.js';

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
 * SQLite implementation of model repository
 */
export class SqliteModelRepository implements IModelRepository {
  constructor(private db: Database.Database) {}

  async save(model: FireModel): Promise<FireModel> {
    // Use INSERT OR REPLACE for upsert behavior
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO fire_models (id, name, engine_type, status, created_at, updated_at)
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

    return model;
  }

  async findById(id: FireModelId): Promise<FireModel | null> {
    const stmt = this.db.prepare(`SELECT * FROM fire_models WHERE id = ?`);
    const row = stmt.get(id) as ModelRow | undefined;
    return row ? rowToModel(row) : null;
  }

  async getById(id: FireModelId): Promise<FireModel> {
    const model = await this.findById(id);
    if (!model) {
      throw new NotFoundError('Model', id);
    }
    return model;
  }

  async find(filter: ModelFilter, options?: ModelQueryOptions): Promise<ModelQueryResult> {
    let query = 'SELECT * FROM fire_models WHERE 1=1';
    const params: unknown[] = [];

    // Apply filters
    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      query += ` AND status IN (${statuses.map(() => '?').join(', ')})`;
      params.push(...statuses);
    }

    if (filter.engineType) {
      query += ' AND engine_type = ?';
      params.push(filter.engineType);
    }

    if (filter.nameContains) {
      query += ' AND name LIKE ?';
      params.push(`%${filter.nameContains}%`);
    }

    if (filter.createdBetween) {
      query += ' AND created_at >= ? AND created_at <= ?';
      params.push(filter.createdBetween.start.toISOString());
      params.push(filter.createdBetween.end.toISOString());
    }

    // Get total count
    const countStmt = this.db.prepare(query.replace('SELECT *', 'SELECT COUNT(*) as count'));
    const countResult = countStmt.get(...params) as { count: number };
    const totalCount = countResult.count;

    // Apply sorting
    const sortBy = options?.sortBy ?? 'createdAt';
    const sortOrder = options?.sortOrder ?? 'desc';
    const columnMap: Record<string, string> = {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      name: 'name',
      status: 'status',
    };
    query += ` ORDER BY ${columnMap[sortBy] ?? 'created_at'} ${sortOrder.toUpperCase()}`;

    // Apply pagination
    if (options?.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }
    if (options?.offset) {
      query += ' OFFSET ?';
      params.push(options.offset);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as ModelRow[];
    const models = rows.map(rowToModel);

    const hasMore = options?.limit
      ? (options.offset ?? 0) + models.length < totalCount
      : false;

    return { models, totalCount, hasMore };
  }

  async findSpatial(_filter: SpatialModelFilter, _options?: ModelQueryOptions): Promise<ModelQueryResult> {
    // SQLite doesn't support spatial queries natively
    // For SAN mode, fall back to non-spatial find
    // In ACN mode with PostGIS, this would use ST_Distance, ST_Within, etc.
    console.warn('[SqliteModelRepository] Spatial queries not supported in SQLite, falling back to basic find');
    return this.find(_filter, _options);
  }

  async updateStatus(id: FireModelId, status: ModelStatus): Promise<FireModel> {
    const model = await this.getById(id);
    const updated = model.withStatus(status);

    const stmt = this.db.prepare(`
      UPDATE fire_models
      SET status = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(updated.status, updated.updatedAt.toISOString(), id);
    return updated;
  }

  async delete(id: FireModelId): Promise<boolean> {
    const stmt = this.db.prepare(`DELETE FROM fire_models WHERE id = ?`);
    const result = stmt.run(id);
    return result.changes > 0;
  }

  async saveResult(_result: ModelResult): Promise<ModelResult> {
    // Delegate to result repository - this is here for interface compliance
    throw new Error('Use IResultRepository.save() instead');
  }

  async getResults(_modelId: FireModelId): Promise<ModelResult[]> {
    // Delegate to result repository - this is here for interface compliance
    throw new Error('Use IResultRepository.findByModelId() instead');
  }

  async findResultById(_id: ModelResultId): Promise<ModelResult | null> {
    // Delegate to result repository - this is here for interface compliance
    throw new Error('Use IResultRepository.findById() instead');
  }

  async deleteResults(_modelId: FireModelId): Promise<number> {
    // Delegate to result repository - this is here for interface compliance
    throw new Error('Use IResultRepository.deleteByModelId() instead');
  }

  async count(filter?: ModelFilter): Promise<number> {
    if (!filter) {
      const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM fire_models`);
      const result = stmt.get() as { count: number };
      return result.count;
    }

    const queryResult = await this.find(filter);
    return queryResult.totalCount;
  }

  async exists(id: FireModelId): Promise<boolean> {
    const stmt = this.db.prepare(`SELECT 1 FROM fire_models WHERE id = ?`);
    const row = stmt.get(id);
    return row !== undefined;
  }

  async findStaleModels(maxAgeMinutes: number): Promise<FireModel[]> {
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
    const stmt = this.db.prepare(`
      SELECT * FROM fire_models
      WHERE status IN (?, ?)
      AND updated_at < ?
      ORDER BY updated_at ASC
    `);

    const rows = stmt.all(
      ModelStatus.Queued,
      ModelStatus.Running,
      cutoff.toISOString()
    ) as ModelRow[];

    return rows.map(rowToModel);
  }
}
