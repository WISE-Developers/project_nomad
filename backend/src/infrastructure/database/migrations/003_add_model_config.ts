/**
 * Migration: Add MCP Model Config
 *
 * Adds config_json column to fire_models for storing MCP tool configuration.
 * Nullable TEXT column storing JSON with ignition, weather, time, and simulation params.
 */
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('fire_models', 'config_json');
  if (!hasColumn) {
    await knex.schema.alterTable('fire_models', (table) => {
      table.text('config_json').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('fire_models', 'config_json');
  if (hasColumn) {
    try {
      await knex.schema.alterTable('fire_models', (table) => {
        table.dropColumn('config_json');
      });
    } catch {
      console.warn('[Migration] Could not drop config_json column - may need manual cleanup on SQLite');
    }
  }
}
