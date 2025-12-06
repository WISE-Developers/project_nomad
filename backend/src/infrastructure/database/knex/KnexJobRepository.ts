/**
 * Knex Job Repository
 *
 * Database-agnostic implementation of IJobRepository using Knex.js.
 * Supports SQLite, PostgreSQL, MySQL, SQL Server, and Oracle.
 */

import { Knex } from 'knex';
import { Job, JobId, createJobId, JobStatus, FireModelId } from '../../../domain/entities/index.js';
import { createFireModelId } from '../../../domain/entities/FireModel.js';
import { createModelResultId } from '../../../domain/entities/ModelResult.js';
import { IJobRepository } from '../../../application/interfaces/index.js';

interface JobRow {
  id: string;
  model_id: string;
  status: string;
  progress: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  result_ids: string | null;
}

/**
 * Converts a database row to a Job entity
 */
function rowToJob(row: JobRow): Job {
  const resultIds = row.result_ids
    ? JSON.parse(row.result_ids).map((id: string) => createModelResultId(id))
    : [];

  return new Job({
    id: createJobId(row.id),
    modelId: createFireModelId(row.model_id),
    status: row.status as JobStatus,
    progress: row.progress,
    createdAt: new Date(row.created_at),
    startedAt: row.started_at ? new Date(row.started_at) : undefined,
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    error: row.error ?? undefined,
    resultIds,
  });
}

/**
 * Knex implementation of job repository
 */
export class KnexJobRepository implements IJobRepository {
  private readonly tableName = 'jobs';
  private schemaChecked = false;

  constructor(private knex: Knex) {}

  /**
   * Ensure result_ids column exists (for schema migration)
   */
  private async ensureResultIdsColumn(): Promise<void> {
    if (this.schemaChecked) return;

    const hasColumn = await this.knex.schema.hasColumn(this.tableName, 'result_ids');
    if (!hasColumn) {
      await this.knex.schema.alterTable(this.tableName, (table) => {
        table.text('result_ids').nullable();
      });
    }
    this.schemaChecked = true;
  }

  async save(job: Job): Promise<Job> {
    await this.ensureResultIdsColumn();

    const data = {
      id: job.id,
      model_id: job.modelId,
      status: job.status,
      progress: job.progress,
      created_at: job.createdAt.toISOString(),
      started_at: job.startedAt?.toISOString() ?? null,
      completed_at: job.completedAt?.toISOString() ?? null,
      error: job.error ?? null,
      result_ids: job.resultIds.length > 0 ? JSON.stringify(job.resultIds) : null,
    };

    // Use onConflict().merge() for upsert behavior
    await this.knex(this.tableName)
      .insert(data)
      .onConflict('id')
      .merge();

    return job;
  }

  async update(job: Job): Promise<Job> {
    await this.ensureResultIdsColumn();

    await this.knex(this.tableName)
      .where({ id: job.id })
      .update({
        status: job.status,
        progress: job.progress,
        started_at: job.startedAt?.toISOString() ?? null,
        completed_at: job.completedAt?.toISOString() ?? null,
        error: job.error ?? null,
        result_ids: job.resultIds.length > 0 ? JSON.stringify(job.resultIds) : null,
      });

    return job;
  }

  async findById(id: JobId): Promise<Job | null> {
    await this.ensureResultIdsColumn();

    const row = await this.knex(this.tableName)
      .where({ id })
      .first<JobRow>();

    return row ? rowToJob(row) : null;
  }

  async findByStatus(status: JobStatus): Promise<Job[]> {
    await this.ensureResultIdsColumn();

    const rows = await this.knex(this.tableName)
      .where({ status })
      .orderBy('created_at', 'desc')
      .select<JobRow[]>('*');

    return rows.map(rowToJob);
  }

  async findByModelId(modelId: FireModelId): Promise<Job[]> {
    await this.ensureResultIdsColumn();

    const rows = await this.knex(this.tableName)
      .where({ model_id: modelId })
      .orderBy('created_at', 'desc')
      .select<JobRow[]>('*');

    return rows.map(rowToJob);
  }

  async findAll(): Promise<Job[]> {
    await this.ensureResultIdsColumn();

    const rows = await this.knex(this.tableName)
      .orderBy('created_at', 'desc')
      .select<JobRow[]>('*');

    return rows.map(rowToJob);
  }

  async delete(id: JobId): Promise<boolean> {
    const deleted = await this.knex(this.tableName)
      .where({ id })
      .delete();

    return deleted > 0;
  }

  async exists(id: JobId): Promise<boolean> {
    const row = await this.knex(this.tableName)
      .where({ id })
      .select(this.knex.raw('1'))
      .first();

    return row !== undefined;
  }

  async markRunningAsFailed(): Promise<number> {
    const result = await this.knex(this.tableName)
      .where({ status: JobStatus.Running })
      .update({
        status: JobStatus.Failed,
        completed_at: new Date().toISOString(),
        error: 'Server restarted while job was running',
      });

    return result;
  }

  async deleteOlderThan(olderThan: Date): Promise<number> {
    const result = await this.knex(this.tableName)
      .whereIn('status', [JobStatus.Completed, JobStatus.Failed, JobStatus.Cancelled])
      .where('completed_at', '<', olderThan.toISOString())
      .delete();

    return result;
  }

  async deleteByModelId(modelId: FireModelId): Promise<number> {
    const result = await this.knex(this.tableName)
      .where({ model_id: modelId })
      .delete();

    return result;
  }
}
