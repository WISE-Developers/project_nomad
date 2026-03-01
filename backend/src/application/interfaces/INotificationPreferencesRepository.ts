/**
 * Notification Preferences Repository Interface
 *
 * Defines the contract for reading and writing per-user notification preferences.
 * Follows Clean Architecture — application layer depends on this abstraction;
 * infrastructure layer provides the Knex implementation.
 */

import { NotificationEventType } from '../../infrastructure/database/migrations/005_create_notification_preferences.js';

export interface NotificationPreference {
  userId: string;
  eventType: NotificationEventType;
  toastEnabled: boolean;
  browserEnabled: boolean;
}

export interface INotificationPreferencesRepository {
  /**
   * Get all preferences for a user.
   * Returns defaults for any event types not yet stored.
   */
  getByUserId(userId: string): Promise<NotificationPreference[]>;

  /**
   * Get preference for a specific user + event type.
   * Returns the default preference if none is stored.
   */
  getByUserAndEvent(userId: string, eventType: NotificationEventType): Promise<NotificationPreference>;

  /**
   * Upsert a preference for a user + event type.
   */
  save(pref: NotificationPreference): Promise<NotificationPreference>;

  /**
   * Upsert all preferences for a user in a single call.
   */
  saveAll(prefs: NotificationPreference[]): Promise<NotificationPreference[]>;
}
