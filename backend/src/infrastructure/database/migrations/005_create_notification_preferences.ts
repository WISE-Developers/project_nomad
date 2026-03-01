/**
 * Migration: Create Notification Preferences
 *
 * Creates the notification_preferences table for storing per-user,
 * per-event-type toast and browser notification settings.
 *
 * Columns:
 *   - user_id:          Identifier for the user (string, not a FK to keep SAN/ACN flexible)
 *   - event_type:       One of model_completed, model_failed, import_completed, import_failed
 *   - toast_enabled:    Whether in-app toast notifications are enabled (boolean, default true)
 *   - browser_enabled:  Whether browser push notifications are enabled (boolean, default false)
 *
 * PK is composite (user_id, event_type) — one row per user per event type.
 */

import { Knex } from 'knex';

export const DEFAULT_EVENT_TYPES = [
  'model_completed',
  'model_failed',
  'import_completed',
  'import_failed',
] as const;

export type NotificationEventType = (typeof DEFAULT_EVENT_TYPES)[number];

export async function up(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('notification_preferences');
  if (!hasTable) {
    await knex.schema.createTable('notification_preferences', (table) => {
      table.string('user_id').notNullable();
      table.string('event_type').notNullable();
      table.boolean('toast_enabled').notNullable().defaultTo(true);
      table.boolean('browser_enabled').notNullable().defaultTo(false);
      table.primary(['user_id', 'event_type']);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('notification_preferences');
  if (hasTable) {
    await knex.schema.dropTable('notification_preferences');
  }
}
