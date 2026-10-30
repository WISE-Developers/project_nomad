/**
 * Migration: Add Time Range Columns
 *
 * Adds time_range_start and time_range_end to fire_models so a model carries
 * the period it was simulated FOR (#482).
 *
 * WHY THIS EXISTS. The run API required `timeRange`, passed it to the engine as
 * an argument, and FireSTARREngine wrote it into the sim directory's
 * `output-config.json`. That file was the only copy — the start date was an
 * argument to a run, never a property of the model. Measured on the 64 real sim
 * directories: 26 have no `timeRange` recorded at all, 14 of those have arrival
 * rasters. A config schema change with no migration and no version marker.
 *
 * NULLABLE, WITH NO DEFAULT, DELIBERATELY. The 26 existing rows predate the
 * field and nothing on disk records their range. They must read NULL, which the
 * repository returns as `undefined`, which every surface renders as unknown. A
 * default — of now, of the current year, of anything — would make those rows
 * indistinguishable from real recorded values, which is the defect being fixed
 * rather than a mitigation of it.
 *
 * Stored as TEXT ISO-8601 UTC, matching created_at/updated_at on this table.
 */
import { Knex } from 'knex';

const COLUMNS = ['time_range_start', 'time_range_end'] as const;

export async function up(knex: Knex): Promise<void> {
  for (const column of COLUMNS) {
    const hasColumn = await knex.schema.hasColumn('fire_models', column);
    if (!hasColumn) {
      await knex.schema.alterTable('fire_models', (table) => {
        table.text(column).nullable();
      });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const column of COLUMNS) {
    const hasColumn = await knex.schema.hasColumn('fire_models', column);
    if (hasColumn) {
      try {
        await knex.schema.alterTable('fire_models', (table) => {
          table.dropColumn(column);
        });
      } catch {
        console.warn(
          `[Migration] Could not drop ${column} column - may need manual cleanup on SQLite`,
        );
      }
    }
  }
}
