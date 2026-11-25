/**
 * An in-memory SQLite database built by the REAL migrations, for tests that need the
 * real Knex repositories. Same set as KnexModelRepository.unowned.test.ts: a hand-written
 * createTable would be a second copy of the schema that drifts.
 */
import knex, { Knex } from 'knex';
import { up as m001 } from '../infrastructure/database/migrations/001_create_tables.js';
import { up as m002 } from '../infrastructure/database/migrations/002_add_user_ownership.js';
import { up as m003 } from '../infrastructure/database/migrations/003_add_model_config.js';
import { up as m006 } from '../infrastructure/database/migrations/006_add_notes_column.js';
import { up as m007 } from '../infrastructure/database/migrations/007_add_output_mode_column.js';
import { up as m009 } from '../infrastructure/database/migrations/009_add_time_range_columns.js';

export async function migratedTestDb(): Promise<Knex> {
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
