/**
 * Knex Notification Preferences Repository
 *
 * Implements INotificationPreferencesRepository using Knex.js.
 * Works with SQLite (SAN) and PostgreSQL (ACN).
 *
 * Uses upsert (onConflict().merge()) to keep preferences idempotent.
 */

import { Knex } from 'knex';
import {
  INotificationPreferencesRepository,
  NotificationPreference,
} from '../../../application/interfaces/INotificationPreferencesRepository.js';
import {
  DEFAULT_EVENT_TYPES,
  NotificationEventType,
} from '../migrations/005_create_notification_preferences.js';

interface PreferenceRow {
  user_id: string;
  event_type: string;
  toast_enabled: number | boolean;
  browser_enabled: number | boolean;
}

function rowToPref(row: PreferenceRow): NotificationPreference {
  return {
    userId: row.user_id,
    eventType: row.event_type as NotificationEventType,
    toastEnabled: Boolean(row.toast_enabled),
    browserEnabled: Boolean(row.browser_enabled),
  };
}

function defaultPref(userId: string, eventType: NotificationEventType): NotificationPreference {
  return {
    userId,
    eventType,
    toastEnabled: true,
    browserEnabled: false,
  };
}

export class KnexNotificationPreferencesRepository implements INotificationPreferencesRepository {
  private readonly tableName = 'notification_preferences';

  constructor(private readonly knex: Knex) {}

  async getByUserId(userId: string): Promise<NotificationPreference[]> {
    const rows = await this.knex(this.tableName)
      .where({ user_id: userId })
      .select<PreferenceRow[]>('*');

    const stored = new Map(rows.map((r) => [r.event_type, rowToPref(r)]));

    // Fill in defaults for any event types not yet stored
    return DEFAULT_EVENT_TYPES.map(
      (eventType) => stored.get(eventType) ?? defaultPref(userId, eventType)
    );
  }

  async getByUserAndEvent(
    userId: string,
    eventType: NotificationEventType
  ): Promise<NotificationPreference> {
    const row = await this.knex(this.tableName)
      .where({ user_id: userId, event_type: eventType })
      .first<PreferenceRow>();

    return row ? rowToPref(row) : defaultPref(userId, eventType);
  }

  async save(pref: NotificationPreference): Promise<NotificationPreference> {
    const data: PreferenceRow = {
      user_id: pref.userId,
      event_type: pref.eventType,
      toast_enabled: pref.toastEnabled ? 1 : 0,
      browser_enabled: pref.browserEnabled ? 1 : 0,
    };

    await this.knex(this.tableName)
      .insert(data)
      .onConflict(['user_id', 'event_type'])
      .merge();

    return pref;
  }

  async saveAll(prefs: NotificationPreference[]): Promise<NotificationPreference[]> {
    if (prefs.length === 0) return [];

    for (const pref of prefs) {
      await this.save(pref);
    }

    return prefs;
  }
}
