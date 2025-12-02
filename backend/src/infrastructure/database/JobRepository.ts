/**
 * Job Repository
 *
 * SQLite persistence for Job entities.
 */

import { getDatabase } from './Database.js';
import { Job, JobId, createJobId, JobStatus } from '../../domain/entities/Job.js';
import { createFireModelId, FireModelId } from '../../domain/entities/FireModel.js';
import { createModelResultId } from '../../domain/entities/ModelResult.js';

interface JobRow {
  id: string;
  model_id: string;
  status: string;
  progress: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  result_ids: string | null; // JSON array
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
 * Save a new job to the database
 */
export function saveJob(job: Job): void {
  const db = getDatabase();

  // Check if job table has result_ids column, add if not
  const columns = db.prepare(`PRAGMA table_info(jobs)`).all() as { name: string }[];
  const hasResultIds = columns.some((col) => col.name === 'result_ids');

  if (!hasResultIds) {
    db.exec(`ALTER TABLE jobs ADD COLUMN result_ids TEXT`);
  }

  const stmt = db.prepare(`
    INSERT INTO jobs (id, model_id, status, progress, created_at, started_at, completed_at, error, result_ids)
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
}

/**
 * Update an existing job
 */
export function updateJob(job: Job): void {
  const db = getDatabase();
  const stmt = db.prepare(`
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
}

/**
 * Find a job by ID
 */
export function findJobById(id: JobId): Job | null {
  const db = getDatabase();
  const stmt = db.prepare(`SELECT * FROM jobs WHERE id = ?`);
  const row = stmt.get(id) as JobRow | undefined;

  return row ? rowToJob(row) : null;
}

/**
 * Find jobs by model ID
 */
export function findJobsByModelId(modelId: FireModelId): Job[] {
  const db = getDatabase();
  const stmt = db.prepare(`SELECT * FROM jobs WHERE model_id = ? ORDER BY created_at DESC`);
  const rows = stmt.all(modelId) as JobRow[];

  return rows.map(rowToJob);
}

/**
 * Find jobs by status
 */
export function findJobsByStatus(status: JobStatus): Job[] {
  const db = getDatabase();
  const stmt = db.prepare(`SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC`);
  const rows = stmt.all(status) as JobRow[];

  return rows.map(rowToJob);
}

/**
 * Get all jobs
 */
export function findAllJobs(): Job[] {
  const db = getDatabase();
  const stmt = db.prepare(`SELECT * FROM jobs ORDER BY created_at DESC`);
  const rows = stmt.all() as JobRow[];

  return rows.map(rowToJob);
}

/**
 * Delete a job by ID
 */
export function deleteJob(id: JobId): boolean {
  const db = getDatabase();
  const stmt = db.prepare(`DELETE FROM jobs WHERE id = ?`);
  const result = stmt.run(id);

  return result.changes > 0;
}

/**
 * Mark all running jobs as failed (for restart recovery)
 */
export function markRunningJobsAsFailed(): number {
  const db = getDatabase();
  const stmt = db.prepare(`
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
