/**
 * Notification event types (domain).
 *
 * The set of events a user can hold notification preferences for. Lives in the
 * domain layer so that ports (e.g. INotificationPreferencesRepository) depend on
 * a domain type rather than importing it from a database migration
 * (Dependency Inversion). Infrastructure (the migration / Knex repo) and the API
 * layer consume the same source of truth.
 */

export const DEFAULT_EVENT_TYPES = [
  'model_completed',
  'model_failed',
  'import_completed',
  'import_failed',
] as const;

export type NotificationEventType = (typeof DEFAULT_EVENT_TYPES)[number];
