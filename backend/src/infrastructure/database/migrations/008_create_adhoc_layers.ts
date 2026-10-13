/**
 * Migration: Ad-hoc layers (#315)
 *
 * Shared ad-hoc WMS layers. Papa's design, 2026-10-13: a **private checkbox**
 * decides the storage. Private layers persist to `localStorage` and never reach
 * the server; everything in THIS table is shared with everyone on the
 * deployment, so there is deliberately no `scope` column — the table *is* the
 * shared set, and a column that is always the same value is a column that will
 * eventually disagree with reality.
 *
 * `created_by` exists because deletion is creator-only: everyone can hide a
 * shared layer from their own map, only its author can remove it for others.
 * "It disappeared and I do not know why" is worse during an incident than "it
 * is wrong and I have hidden it."
 */
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('adhoc_layers');
  if (exists) return;

  await knex.schema.createTable('adhoc_layers', (table) => {
    table.text('id').primary();

    /** What the user called it. Shown in the layer panel. */
    table.text('name').notNullable();

    /** The WMS service endpoint, as the user supplied it. */
    table.text('service_url').notNullable();

    /** The layer name as the server publishes it, e.g. `nrcan:canvec_hydro`. */
    table.text('layer_name').notNullable();

    /**
     * Read from the server's own capabilities document, never guessed: 1.3.0
     * takes `crs`, 1.1.1 takes `srs`, and the wrong one renders a layer offset
     * rather than failing.
     */
    table.text('wms_version').notNullable().defaultTo('1.3.0');

    /** GetLegendGraphic URL when the server offers one. */
    table.text('legend_url').nullable();

    /**
     * From resolveUserId — ACN user, email, or simple-mode name. Nullable
     * because NOMAD_AUTH_MODE=none has no identity at all; in that mode there
     * is exactly one user, so an unattributed row is honest rather than a gap.
     */
    table.text('created_by').nullable();

    table.text('created_at').notNullable();

    table.index(['created_by'], 'idx_adhoc_layers_created_by');
  });
}

export async function down(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('adhoc_layers');
  if (exists) {
    await knex.schema.dropTable('adhoc_layers');
  }
}
