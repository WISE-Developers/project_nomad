/**
 * Migration: Create Initial Tables
 *
 * Creates the core tables for Nomad:
 * - fire_models: Fire model metadata
 * - jobs: Execution job tracking
 * - model_results: Output file references
 */

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Create fire_models table (if not exists for compatibility with existing databases)
  const hasFireModels = await knex.schema.hasTable('fire_models');
  if (!hasFireModels) {
    await knex.schema.createTable('fire_models', (table) => {
      table.string('id').primary();
      table.string('name').notNullable();
      table.string('engine_type').notNullable();
      table.string('status').notNullable();
      table.string('created_at').notNullable();
      table.string('updated_at').notNullable();
    });
  }

  // Create jobs table
  const hasJobs = await knex.schema.hasTable('jobs');
  if (!hasJobs) {
    await knex.schema.createTable('jobs', (table) => {
      table.string('id').primary();
      table.string('model_id').notNullable();
      table.string('status').notNullable();
      table.integer('progress').defaultTo(0);
      table.string('created_at').notNullable();
      table.string('started_at').nullable();
      table.string('completed_at').nullable();
      table.text('error').nullable();
      table.text('result_ids').nullable();

      // Foreign key
      table.foreign('model_id').references('id').inTable('fire_models');
    });
  }

  // Create model_results table
  const hasResults = await knex.schema.hasTable('model_results');
  if (!hasResults) {
    await knex.schema.createTable('model_results', (table) => {
      table.string('id').primary();
      table.string('model_id').notNullable();
      table.string('name').notNullable();
      table.string('output_type').notNullable();
      table.string('format').notNullable();
      table.string('file_path').notNullable();
      table.text('metadata').nullable();
      table.string('created_at').notNullable();

      // Foreign key
      table.foreign('model_id').references('id').inTable('fire_models');
    });
  }

  // Create indexes for common queries (only if tables were just created)
  // SQLite doesn't support IF NOT EXISTS for indexes, so we use try/catch
  try {
    if (!hasJobs) {
      await knex.schema.alterTable('jobs', (table) => {
        table.index('model_id', 'idx_jobs_model_id');
        table.index('status', 'idx_jobs_status');
      });
    }
  } catch {
    // Indexes might already exist
  }

  try {
    if (!hasResults) {
      await knex.schema.alterTable('model_results', (table) => {
        table.index('model_id', 'idx_results_model_id');
      });
    }
  } catch {
    // Index might already exist
  }
}

export async function down(knex: Knex): Promise<void> {
  // Drop tables in reverse order (due to foreign keys)
  await knex.schema.dropTableIfExists('model_results');
  await knex.schema.dropTableIfExists('jobs');
  await knex.schema.dropTableIfExists('fire_models');
}
