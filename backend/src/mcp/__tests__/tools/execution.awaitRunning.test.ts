/**
 * The MCP execute path waits for the job to be marked running (finding F4 of
 * verification/job-lifecycle).
 *
 * It used to call `jobQueue.updateStatus(job.id, Running).catch(() => {})` without
 * awaiting it. Nothing ordered that write against the finalizer's, so when the database
 * was slow to apply it and the engine failed fast, the late "running" write landed after
 * "failed" and the finished job said running forever.
 *
 * Real JobQueue and Knex repositories on the real migrations. The only fakes are the
 * engine, which fails at once, and a job repository whose FIRST update is slow: that is
 * the database being slow to apply the mark-running write.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Knex } from 'knex';

const h = vi.hoisted(() => ({ db: null as unknown, updates: 0 }));

vi.mock('../../../infrastructure/usage/index.js', () => ({
  getUsageLogger: () => ({ record: async () => {} }),
}));

vi.mock('../../../infrastructure/database/index.js', async () => {
  const { KnexModelRepository } = await import('../../../infrastructure/database/knex/KnexModelRepository.js');
  const { KnexJobRepository } = await import('../../../infrastructure/database/knex/KnexJobRepository.js');
  class SlowFirstUpdate extends KnexJobRepository {
    private async slowIfFirst() {
      h.updates += 1;
      if (h.updates === 1) await new Promise((r) => setTimeout(r, 50));
    }
    async update(job: Parameters<KnexJobRepository['update']>[0]) {
      await this.slowIfFirst();
      return super.update(job);
    }
    async updateIfActive(job: Parameters<KnexJobRepository['update']>[0]) {
      await this.slowIfFirst();
      return (super.updateIfActive as (j: typeof job) => Promise<boolean>)(job);
    }
  }
  return {
    getModelRepository: () => new KnexModelRepository(h.db as Knex),
    getJobRepository: () => new SlowFirstUpdate(h.db as Knex),
    getResultRepository: () => ({ save: async () => undefined, findByModelId: async () => [] }),
  };
});

vi.mock('../../../infrastructure/engines/index.js', () => ({
  getEngine: () => ({
    initialize: async () => undefined,
    execute: async () => {
      throw new Error('FireSTARR image not found');
    },
    getStatus: async () => ({ state: 'failed', error: 'FireSTARR image not found' }),
    getResults: async () => [],
    cancel: async () => undefined,
  }),
}));

import { submitModelForExecution } from '../../tools/execution.js';
import { resetJobQueue } from '../../../infrastructure/services/JobQueue.js';
import { KnexModelRepository } from '../../../infrastructure/database/knex/KnexModelRepository.js';
import { KnexJobRepository } from '../../../infrastructure/database/knex/KnexJobRepository.js';
import {
  EngineType,
  FireModel,
  JobStatus,
  ModelStatus,
  createFireModelId,
} from '../../../domain/entities/index.js';
import { migratedTestDb } from '../../../test/migratedTestDb.js';

const MODEL_ID = 'model-f4';

beforeEach(async () => {
  h.db = await migratedTestDb();
  h.updates = 0;
  resetJobQueue();
  const models = new KnexModelRepository(h.db as Knex);
  await models.save(
    new FireModel({
      id: createFireModelId(MODEL_ID),
      name: 'MCP F4',
      engineType: EngineType.FireSTARR,
      status: ModelStatus.Draft,
    }),
  );
  await models.saveConfigJson(createFireModelId(MODEL_ID), {
    ignition: { type: 'point', coordinates: [-114.3, 62.5] },
    weather: { source: 'firestarr_csv', firestarrCsvContent: 'datetime,temp\n2026-06-15T14:00:00Z,30' },
    timeRange: { start: '2026-06-15T14:00:00Z', end: '2026-06-15T20:00:00Z' },
    timezone: 'America/Edmonton',
  });
});

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 100));
  await (h.db as Knex).destroy();
});

describe('MCP execute-model when the engine fails at once', () => {
  it('leaves the job failed, not running', async () => {
    const result = await submitModelForExecution({ modelId: MODEL_ID });
    expect(result.isError).toBeFalsy();

    // Give the slow first write every chance to land last.
    await new Promise((r) => setTimeout(r, 150));

    const [job] = await new KnexJobRepository(h.db as Knex).findByModelId(createFireModelId(MODEL_ID));
    expect(job.status).toBe(JobStatus.Failed);
    const model = await new KnexModelRepository(h.db as Knex).findById(createFireModelId(MODEL_ID));
    expect(model!.status).toBe(ModelStatus.Failed);
  });
});
