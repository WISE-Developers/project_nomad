/**
 * Knex Model Repository
 *
 * Database-agnostic implementation of IModelRepository using Knex.js.
 * Supports SQLite, PostgreSQL, MySQL, SQL Server, and Oracle.
 */

import { Knex } from 'knex';
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
  user_id: string | null;
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
    userId: row.user_id ?? undefined,
  });
}

/**
 * Knex implementation of model repository
 */
export class KnexModelRepository implements IModelRepository {
  private readonly tableName = 'fire_models';

  constructor(private knex: Knex) {}

  async save(model: FireModel): Promise<FireModel> {
    const data = {
      id: model.id,
      name: model.name,
      engine_type: model.engineType,
      status: model.status,
      created_at: model.createdAt.toISOString(),
      updated_at: model.updatedAt.toISOString(),
      user_id: model.userId ?? null,
    };

    // Use onConflict().merge() for upsert behavior (works across databases)
    await this.knex(this.tableName)
      .insert(data)
      .onConflict('id')
      .merge();

    return model;
  }

  async findById(id: FireModelId): Promise<FireModel | null> {
    const row = await this.knex(this.tableName)
      .where({ id })
      .first<ModelRow>();

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
    let query = this.knex(this.tableName);

    // Apply filters
    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      query = query.whereIn('status', statuses);
    }

    if (filter.engineType) {
      query = query.where('engine_type', filter.engineType);
    }

    if (filter.nameContains) {
      query = query.where('name', 'like', `%${filter.nameContains}%`);
    }

    if (filter.createdBetween) {
      query = query
        .where('created_at', '>=', filter.createdBetween.start.toISOString())
        .where('created_at', '<=', filter.createdBetween.end.toISOString());
    }

    // Filter by user ownership
    if (filter.userId) {
      query = query.where('user_id', filter.userId);
    }

    // Get total count (clone query before pagination)
    const countQuery = query.clone();
    const [{ count: totalCount }] = await countQuery.count('* as count');
    const total = Number(totalCount);

    // Apply sorting
    const sortBy = options?.sortBy ?? 'createdAt';
    const sortOrder = options?.sortOrder ?? 'desc';
    const columnMap: Record<string, string> = {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      name: 'name',
      status: 'status',
    };
    query = query.orderBy(columnMap[sortBy] ?? 'created_at', sortOrder);

    // Apply pagination
    if (options?.limit) {
      query = query.limit(options.limit);
    }
    if (options?.offset) {
      query = query.offset(options.offset);
    }

    const rows = await query.select<ModelRow[]>('*');
    const models = rows.map(rowToModel);

    const hasMore = options?.limit
      ? (options.offset ?? 0) + models.length < total
      : false;

    return { models, totalCount: total, hasMore };
  }

  async findSpatial(_filter: SpatialModelFilter, _options?: ModelQueryOptions): Promise<ModelQueryResult> {
    throw new Error('Spatial queries not yet implemented — requires PostGIS/SpatiaLite extensions');
  }

  async updateStatus(id: FireModelId, status: ModelStatus): Promise<FireModel> {
    const model = await this.getById(id);
    const updated = model.withStatus(status);

    await this.knex(this.tableName)
      .where({ id })
      .update({
        status: updated.status,
        updated_at: updated.updatedAt.toISOString(),
      });

    return updated;
  }

  async delete(id: FireModelId): Promise<boolean> {
    const deleted = await this.knex(this.tableName)
      .where({ id })
      .delete();

    return deleted > 0;
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
      const [{ count }] = await this.knex(this.tableName).count('* as count');
      return Number(count);
    }

    const queryResult = await this.find(filter);
    return queryResult.totalCount;
  }

  async exists(id: FireModelId): Promise<boolean> {
    const row = await this.knex(this.tableName)
      .where({ id })
      .select(this.knex.raw('1'))
      .first();

    return row !== undefined;
  }

  async findStaleModels(maxAgeMinutes: number): Promise<FireModel[]> {
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);

    const rows = await this.knex(this.tableName)
      .whereIn('status', [ModelStatus.Queued, ModelStatus.Running])
      .where('updated_at', '<', cutoff.toISOString())
      .orderBy('updated_at', 'asc')
      .select<ModelRow[]>('*');

    return rows.map(rowToModel);
  }

  async getConfigJson(id: FireModelId): Promise<Record<string, unknown> | null> {
    const row = await this.knex(this.tableName).where({ id }).select('config_json').first();
    if (!row || !row.config_json) return null;
    return JSON.parse(row.config_json);
  }

  async saveConfigJson(id: FireModelId, config: Record<string, unknown>): Promise<void> {
    await this.knex(this.tableName).where({ id }).update({
      config_json: JSON.stringify(config),
      updated_at: this.knex.fn.now(),
    });
  }
}
