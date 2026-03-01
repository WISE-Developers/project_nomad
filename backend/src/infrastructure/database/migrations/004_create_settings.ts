/**
 * Migration: Create Settings Table
 *
 * Adds a key-value settings table for storing UI-configurable values
 * (e.g. CFS FireSTARR API key). UI settings override env vars.
 */
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('settings');
  if (!hasTable) {
    await knex.schema.createTable('settings', (table) => {
      table.text('key').primary();
      table.text('value').notNullable();
      table.datetime('updated_at').defaultTo(knex.fn.now());
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('settings');
}
