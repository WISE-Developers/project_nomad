/**
 * Migration: Add Output Mode Column
 *
 * Adds output_mode column to fire_models for storing the output mode
 * selected at model creation time (probabilistic, pseudo-deterministic).
 * Nullable TEXT column.
 */
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('fire_models', 'output_mode');
  if (!hasColumn) {
    await knex.schema.alterTable('fire_models', (table) => {
      table.text('output_mode').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('fire_models', 'output_mode');
  if (hasColumn) {
    try {
      await knex.schema.alterTable('fire_models', (table) => {
        table.dropColumn('output_mode');
      });
    } catch {
      console.warn('[Migration] Could not drop output_mode column - may need manual cleanup on SQLite');
    }
  }
}
