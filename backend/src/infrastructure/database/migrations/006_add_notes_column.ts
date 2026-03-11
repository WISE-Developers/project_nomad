/**
 * Migration: Add Notes Column
 *
 * Adds notes column to fire_models for storing user-provided notes on model runs.
 * Nullable TEXT column.
 */
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('fire_models', 'notes');
  if (!hasColumn) {
    await knex.schema.alterTable('fire_models', (table) => {
      table.text('notes').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('fire_models', 'notes');
  if (hasColumn) {
    try {
      await knex.schema.alterTable('fire_models', (table) => {
        table.dropColumn('notes');
      });
    } catch {
      console.warn('[Migration] Could not drop notes column - may need manual cleanup on SQLite');
    }
  }
}
