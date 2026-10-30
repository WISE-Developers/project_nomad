/**
 * KnexModelRepository — the time range survives a round trip (#482).
 *
 * The entity holding a field and the repository persisting it are two different
 * facts, and this codebase has already been bitten by the gap: `rowToModel` and
 * `save` are a hand-kept pair, so a field added to one and not the other
 * compiles, passes tsc, and silently loses data on write or reads back
 * undefined on load.
 *
 * The table here is built by RUNNING THE REAL MIGRATIONS rather than by a
 * hand-written `createTable`. A hand-written one would be a second copy of the
 * schema that drifts — `src/mcp/__tests__/migration.test.ts:20` is exactly that,
 * a mirror of 001 "+ subsequent migrations" maintained by memory. Running the
 * actual chain means this test fails if migration 009 is wrong OR if the
 * repository is wrong, and cannot pass by agreeing with a fixture.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import knex, { Knex } from 'knex';
import { KnexModelRepository } from '../KnexModelRepository.js';
import {
  FireModel,
  createFireModelId,
  EngineType,
  ModelStatus,
} from '../../../../domain/entities/index.js';
import { TimeRange } from '../../../../domain/value-objects/index.js';

import { up as m001 } from '../../migrations/001_create_tables.js';
import { up as m002 } from '../../migrations/002_add_user_ownership.js';
import { up as m003 } from '../../migrations/003_add_model_config.js';
import { up as m006 } from '../../migrations/006_add_notes_column.js';
import { up as m007 } from '../../migrations/007_add_output_mode_column.js';
import { up as m009 } from '../../migrations/009_add_time_range_columns.js';

const START = new Date('2023-06-19T12:00:00.000Z');
const END = new Date('2023-06-22T12:00:00.000Z');

async function migratedDb(): Promise<Knex> {
  const db = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  for (const up of [m001, m002, m003, m006, m007, m009]) {
    await up(db);
  }
  return db;
}

describe('KnexModelRepository persists the simulated time range', () => {
  let db: Knex;
  let repo: KnexModelRepository;

  beforeEach(async () => {
    db = await migratedDb();
    repo = new KnexModelRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe('the controls', () => {
    it('the migrated table really has the columns — otherwise every save below is a no-op', async () => {
      expect(await db.schema.hasColumn('fire_models', 'time_range_start')).toBe(true);
      expect(await db.schema.hasColumn('fire_models', 'time_range_end')).toBe(true);
    });
  });

  it('saves and reads back the time range', async () => {
    const id = createFireModelId('round-trip');
    await repo.save(
      new FireModel({
        id,
        name: 'Fort Smith reconstruction',
        engineType: EngineType.FireSTARR,
        status: ModelStatus.Queued,
        timeRange: new TimeRange(START, END),
      }),
    );

    const loaded = await repo.getById(id);

    expect(loaded.timeRange?.start.toISOString()).toBe(START.toISOString());
    expect(loaded.timeRange?.end.toISOString()).toBe(END.toISOString());
  });

  it('writes the range to the COLUMNS, not only into the entity', async () => {
    // The discriminator. A `save` that returned its argument unchanged — which
    // it does, it returns `model` — would satisfy a round trip that went
    // through the same object. This one goes to the database and looks.
    const id = createFireModelId('columns');
    await repo.save(
      new FireModel({
        id,
        name: 'Persisted',
        engineType: EngineType.FireSTARR,
        timeRange: new TimeRange(START, END),
      }),
    );

    const row = await db('fire_models').where({ id }).first();
    expect(row.time_range_start).toBe(START.toISOString());
    expect(row.time_range_end).toBe(END.toISOString());
  });

  it('reads a legacy NULL row back as undefined, never as a date', async () => {
    // The 26. A row written before the column existed must come back with no
    // range at all. `undefined` is the contract every consumer branches on.
    await db('fire_models').insert({
      id: 'legacy',
      name: 'Run that predates the field',
      engine_type: 'firestarr',
      status: 'completed',
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
    });

    const loaded = await repo.getById(createFireModelId('legacy'));

    expect(loaded.timeRange).toBeUndefined();
  });

  it('a model saved without a range stores NULL, not an invented one', async () => {
    const id = createFireModelId('no-range');
    await repo.save(
      new FireModel({ id, name: 'Draft', engineType: EngineType.FireSTARR }),
    );

    const row = await db('fire_models').where({ id }).first();
    expect(row.time_range_start).toBeNull();
    expect(row.time_range_end).toBeNull();
  });

  it('the range survives a status update through the repository', async () => {
    // `updateStatus` loads, calls `withStatus`, and writes a PARTIAL update. If
    // it ever became a full `save` of a copy that dropped the field, the range
    // would be wiped at the moment the run completed — the exact shape of the
    // bug being fixed, reappearing on the success path only.
    const id = createFireModelId('completing');
    await repo.save(
      new FireModel({
        id,
        name: 'Completing run',
        engineType: EngineType.FireSTARR,
        status: ModelStatus.Running,
        timeRange: new TimeRange(START, END),
      }),
    );

    const updated = await repo.updateStatus(id, ModelStatus.Completed);
    expect(updated.timeRange?.start.toISOString()).toBe(START.toISOString());

    const reloaded = await repo.getById(id);
    expect(reloaded.status).toBe(ModelStatus.Completed);
    expect(reloaded.timeRange?.start.toISOString()).toBe(START.toISOString());
    expect(reloaded.timeRange?.end.toISOString()).toBe(END.toISOString());
  });

  it('the range comes back through find() as well as findById()', async () => {
    // `find` maps rows through the same `rowToModel`, but it selects with '*'
    // and a different code path builds the query. Asserted so a column missing
    // from one of the two select paths is caught here.
    const id = createFireModelId('listed');
    await repo.save(
      new FireModel({
        id,
        name: 'Listed run',
        engineType: EngineType.FireSTARR,
        status: ModelStatus.Completed,
        timeRange: new TimeRange(START, END),
      }),
    );

    const { models } = await repo.find({ status: ModelStatus.Completed });

    expect(models).toHaveLength(1);
    expect(models[0].timeRange?.start.toISOString()).toBe(START.toISOString());
  });
});
