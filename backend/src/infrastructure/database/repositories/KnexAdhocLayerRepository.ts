/**
 * Shared ad-hoc layers (#315).
 *
 * Everything in this table is shared with everyone on the deployment. Private
 * layers never arrive here — they live in the browser's `localStorage`, which
 * is why there is no `scope` column to filter on.
 */
import { Knex } from 'knex';
import { getKnex } from '../knex/index.js';

export interface AdhocLayerRow {
  id: string;
  name: string;
  service_url: string;
  layer_name: string;
  wms_version: string;
  legend_url: string | null;
  /** null under NOMAD_AUTH_MODE=none, where there is no identity to record. */
  created_by: string | null;
  created_at: string;
}

export class KnexAdhocLayerRepository {
  private readonly tableName = 'adhoc_layers';
  private readonly knex: Knex;

  constructor(knex?: Knex) {
    this.knex = knex ?? getKnex();
  }

  /** Every shared layer. There is no per-user filter: that is what shared means. */
  async list(): Promise<AdhocLayerRow[]> {
    return this.knex<AdhocLayerRow>(this.tableName).select('*').orderBy('created_at', 'asc');
  }

  async findById(id: string): Promise<AdhocLayerRow | null> {
    const row = await this.knex<AdhocLayerRow>(this.tableName).where({ id }).first();
    return row ?? null;
  }

  async create(row: AdhocLayerRow): Promise<AdhocLayerRow> {
    await this.knex(this.tableName).insert(row);
    return row;
  }

  /** True when a row was removed, false when there was nothing to remove. */
  async deleteById(id: string): Promise<boolean> {
    const removed = await this.knex(this.tableName).where({ id }).delete();
    return removed > 0;
  }
}

let instance: KnexAdhocLayerRepository | undefined;

export function getAdhocLayerRepository(): KnexAdhocLayerRepository {
  if (!instance) instance = new KnexAdhocLayerRepository();
  return instance;
}
