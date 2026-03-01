/**
 * Knex Settings Repository
 *
 * Stores key-value application settings in the database.
 * DB values take precedence over process.env; env vars act as defaults.
 */

import { Knex } from 'knex';
import { getKnex } from '../knex/index.js';

interface SettingsRow {
  key: string;
  value: string;
  updated_at: string;
}

export class KnexSettingsRepository {
  private readonly tableName = 'settings';
  private readonly knex: Knex;

  constructor(knex?: Knex) {
    this.knex = knex ?? getKnex();
  }

  /**
   * Get a setting value.
   * Returns the DB-stored value if present, otherwise falls back to process.env[key].
   * Returns null if neither source has a value.
   */
  async get(key: string): Promise<string | null> {
    const row = await this.knex(this.tableName)
      .where({ key })
      .first<SettingsRow>();

    if (row) {
      return row.value;
    }

    const envValue = process.env[key];
    return envValue ?? null;
  }

  /**
   * Get a setting value with source information.
   * Returns { value, source: 'db' | 'env' } or null if not found.
   */
  async getWithSource(key: string): Promise<{ value: string; source: 'db' | 'env' } | null> {
    const row = await this.knex(this.tableName)
      .where({ key })
      .first<SettingsRow>();

    if (row) {
      return { value: row.value, source: 'db' };
    }

    const envValue = process.env[key];
    if (envValue !== undefined) {
      return { value: envValue, source: 'env' };
    }

    return null;
  }

  /**
   * Upsert a setting value (UI override).
   */
  async set(key: string, value: string): Promise<void> {
    await this.knex(this.tableName)
      .insert({ key, value, updated_at: new Date().toISOString() })
      .onConflict('key')
      .merge(['value', 'updated_at']);
  }

  /**
   * Remove a UI override (reverts to env var default).
   * Returns true if a row was deleted.
   */
  async delete(key: string): Promise<boolean> {
    const count = await this.knex(this.tableName).where({ key }).delete();
    return count > 0;
  }
}
