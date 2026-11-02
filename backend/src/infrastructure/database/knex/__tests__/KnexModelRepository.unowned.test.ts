/**
 * KnexModelRepository — `includeUnowned` matches rows with no recorded owner (#489).
 *
 * The route-level tests for this decision run against a repository MOCK that
 * reimplements the filter's semantics. That mock cannot catch a mistake in the SQL,
 * and the specific mistake available here is a nasty one: an ungrouped `orWhereNull`
 * escapes the preceding conditions, turning
 *
 *   status = 'draft' AND user_id IN (...)
 * into
 *   (status = 'draft' AND user_id IN (...)) OR user_id IS NULL
 *
 * which returns unowned rows of EVERY status. That is invisible to a mock and
 * invisible to a test that only ever filters on one column, so the status-plus-owner
 * case below is the point of this file rather than an extra.
 *
 * The table is built by running the REAL migrations, following the precedent in
 * KnexModelRepository.timeRange.test.ts: a hand-written createTable would be a second
 * copy of the schema that drifts, and could pass by agreeing with itself.
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

import { up as m001 } from '../../migrations/001_create_tables.js';
import { up as m002 } from '../../migrations/002_add_user_ownership.js';
import { up as m003 } from '../../migrations/003_add_model_config.js';
import { up as m006 } from '../../migrations/006_add_notes_column.js';
import { up as m007 } from '../../migrations/007_add_output_mode_column.js';
import { up as m009 } from '../../migrations/009_add_time_range_columns.js';

const ME = 'me@example.test';
const SOMEONE_ELSE = 'other@example.test';

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

describe('KnexModelRepository — unowned rows and identity scoping (#489)', () => {
  let db: Knex;
  let repo: KnexModelRepository;

  beforeEach(async () => {
    db = await migratedDb();
    repo = new KnexModelRepository(db);

    await repo.save(
      new FireModel({ id: createFireModelId('mine'), name: 'mine', engineType: EngineType.FireSTARR, userId: ME })
    );
    await repo.save(
      new FireModel({
        id: createFireModelId('theirs'),
        name: 'theirs',
        engineType: EngineType.FireSTARR,
        userId: SOMEONE_ELSE,
      })
    );
    // The #488 shape: a historical row with no recorded author. Inserted directly,
    // because that is how it exists in the database — written before ownership was
    // ever recorded.
    await db('fire_models').insert({
      id: 'unowned',
      name: 'unowned',
      engine_type: EngineType.FireSTARR,
      status: ModelStatus.Draft,
      user_id: null,
      created_at: new Date('2026-06-30T00:00:00Z').toISOString(),
      updated_at: new Date('2026-06-30T00:00:00Z').toISOString(),
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('CONTROL — the row really is NULL in the database, not the empty string', async () => {
    // If this stored '' instead, every expectation below would be testing nothing:
    // `orWhereNull` would never match and the "unowned invisible" case would pass
    // for the wrong reason.
    const row = await db('fire_models').where({ id: 'unowned' }).first();
    expect(row.user_id).toBeNull();
  });

  it('without includeUnowned, an identity sees only its own rows', async () => {
    const result = await repo.find({ userId: [ME] });
    expect(result.models.map((m) => String(m.id))).toEqual(['mine']);
  });

  it('with includeUnowned, an identity sees its own rows AND the unowned one', async () => {
    const result = await repo.find({ userId: [ME], includeUnowned: true });
    expect(result.models.map((m) => String(m.id)).sort()).toEqual(['mine', 'unowned']);
  });

  it('an identity owning NOTHING still sees the unowned row rather than an empty list', async () => {
    const result = await repo.find({ userId: ['nobody@example.test'], includeUnowned: true });
    expect(result.models.map((m) => String(m.id))).toEqual(['unowned']);
  });

  it('never leaks another operator\'s rows', async () => {
    const result = await repo.find({ userId: [ME], includeUnowned: true });
    expect(result.models.map((m) => String(m.id))).not.toContain('theirs');
  });

  it('THE GROUPING TEST — includeUnowned must not escape the other filters', async () => {
    // Give the unowned row a status the caller is not asking for. With a correctly
    // grouped WHERE it is excluded; with a bare `.orWhereNull()` it comes back
    // regardless of status, and so would every other unowned row in the table.
    await db('fire_models').where({ id: 'unowned' }).update({ status: ModelStatus.Completed });

    const result = await repo.find({
      userId: [ME],
      includeUnowned: true,
      status: ModelStatus.Draft,
    });

    expect(result.models.map((m) => String(m.id))).toEqual(['mine']);
  });

  it('the total count respects the same grouping as the rows', async () => {
    // totalCount comes from a cloned query, so it can disagree with the page if the
    // filter is applied in the wrong place — a pagination bug that only shows up as
    // a wrong number, never as wrong rows.
    const result = await repo.find({ userId: [ME], includeUnowned: true });
    expect(result.totalCount).toBe(result.models.length);
    expect(result.totalCount).toBe(2);
  });

  it('a single-identity string behaves the same as a one-element array', async () => {
    const asArray = await repo.find({ userId: [ME], includeUnowned: true });
    const asString = await repo.find({ userId: ME, includeUnowned: true });
    expect(asString.models.map((m) => String(m.id)).sort()).toEqual(
      asArray.models.map((m) => String(m.id)).sort()
    );
  });

  it('an unscoped query is unaffected and still returns everything', async () => {
    const result = await repo.find({});
    expect(result.models).toHaveLength(3);
  });
});
