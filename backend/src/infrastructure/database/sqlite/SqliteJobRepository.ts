/**
 * SQLite Job Repository
 *
 * SQLite implementation of IJobRepository for SAN mode.
 */

import Database from 'better-sqlite3';
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
 * SQLite implementation of job repository
 */
export class SqliteJobRepository implements IJobRepository {
  constructor(private db: Database.Database) {
    this.ensureResultIdsColumn();
  }

  private ensureResultIdsColumn(): void {
    const columns = this.db.prepare(`PRAGMA table_info(jobs)`).all() as { name: string }[];
    const hasResultIds = columns.some((col) => col.name === 'result_ids');
    if (!hasResultIds) {
      this.db.exec(`ALTER TABLE jobs ADD COLUMN result_ids TEXT`);
    }
  }

  async save(job: Job): Promise<Job> {
    // Use INSERT OR REPLACE for upsert behavior
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO jobs (id, model_id, status, progress, created_at, started_at, completed_at, error, result_ids)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      job.id,
      job.modelId,
      job.status,
      job.progress,
      job.createdAt.toISOString(),
      job.startedAt?.toISOString() ?? null,
      job.completedAt?.toISOString() ?? null,
      job.error ?? null,
      job.resultIds.length > 0 ? JSON.stringify(job.resultIds) : null
    );

    return job;
  }

  async update(job: Job): Promise<Job> {
    const stmt = this.db.prepare(`
      UPDATE jobs
      SET status = ?, progress = ?, started_at = ?, completed_at = ?, error = ?, result_ids = ?
      WHERE id = ?
    `);

    stmt.run(
      job.status,
      job.progress,
      job.startedAt?.toISOString() ?? null,
      job.completedAt?.toISOString() ?? null,
      job.error ?? null,
      job.resultIds.length > 0 ? JSON.stringify(job.resultIds) : null,
      job.id
    );

    return job;
  }

  async findById(id: JobId): Promise<Job | null> {
    const stmt = this.db.prepare(`SELECT * FROM jobs WHERE id = ?`);
    const row = stmt.get(id) as JobRow | undefined;
    return row ? rowToJob(row) : null;
  }

  async findByStatus(status: JobStatus): Promise<Job[]> {
    const stmt = this.db.prepare(`SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC`);
    const rows = stmt.all(status) as JobRow[];
    return rows.map(rowToJob);
  }

  async findByModelId(modelId: FireModelId): Promise<Job[]> {
    const stmt = this.db.prepare(`SELECT * FROM jobs WHERE model_id = ? ORDER BY created_at DESC`);
    const rows = stmt.all(modelId) as JobRow[];
    return rows.map(rowToJob);
  }

  async findAll(): Promise<Job[]> {
    const stmt = this.db.prepare(`SELECT * FROM jobs ORDER BY created_at DESC`);
    const rows = stmt.all() as JobRow[];
    return rows.map(rowToJob);
  }

  async delete(id: JobId): Promise<boolean> {
    const stmt = this.db.prepare(`DELETE FROM jobs WHERE id = ?`);
    const result = stmt.run(id);
    return result.changes > 0;
  }

  async exists(id: JobId): Promise<boolean> {
    const stmt = this.db.prepare(`SELECT 1 FROM jobs WHERE id = ?`);
    const row = stmt.get(id);
    return row !== undefined;
  }

  async markRunningAsFailed(): Promise<number> {
    const stmt = this.db.prepare(`
      UPDATE jobs
      SET status = ?, completed_at = ?, error = ?
      WHERE status = ?
    `);

    const result = stmt.run(
      JobStatus.Failed,
      new Date().toISOString(),
      'Server restarted while job was running',
      JobStatus.Running
    );

    return result.changes;
  }

  async deleteOlderThan(olderThan: Date): Promise<number> {
    const stmt = this.db.prepare(`
      DELETE FROM jobs
      WHERE status IN (?, ?, ?)
      AND completed_at < ?
    `);

    const result = stmt.run(
      JobStatus.Completed,
      JobStatus.Failed,
      JobStatus.Cancelled,
      olderThan.toISOString()
    );

    return result.changes;
  }

  async deleteByModelId(modelId: FireModelId): Promise<number> {
    const stmt = this.db.prepare(`DELETE FROM jobs WHERE model_id = ?`);
    const result = stmt.run(modelId);
    return result.changes;
  }
}
