/**
 * Usage log domain types (#332).
 *
 * A usage event is an immutable record that something happened. Events are
 * append-only; nothing rewrites one after it is created.
 */

/**
 * The kinds of thing worth recording.
 *
 * `app.started` doubles as a segment boundary: NOMAD_AUTH_MODE is an env var,
 * so changing it requires a restart, which means auth_mode recorded here is
 * authoritative for every event until the next app.started.
 */
export type UsageEventType =
  | 'app.started'
  | 'session.login'
  | 'session.logout'
  | 'model.run.started'
  | 'model.run.completed'
  | 'model.run.failed'
  | 'model.exported'
  | 'usage.read';

/** Auth modes Nomad can run in. Determines how `actor` is resolved. */
export type AuthMode = 'none' | 'simple' | 'oauth' | 'acn';

/**
 * Per-event extra payload. Deliberately loose: each event type carries
 * different detail, and the log is append-only rather than schema-migrated.
 *
 * Detail can never overwrite a common field — see createUsageEvent.
 */
export type UsageEventDetail = Record<string, unknown>;

/**
 * A single usage log record.
 *
 * Timestamps are a pair, and they are not interchangeable:
 *   - `ts_utc`   the machine field. Sort key, and the basis for all duration
 *                math. Comparable across deployments in different zones.
 *   - `ts_local` the human field. The deployment's own wall clock, carrying an
 *                explicit offset so it is right on both sides of every DST
 *                boundary. READ ONLY - nothing should ever compute against it.
 */
export interface UsageEvent {
  /** Unique per event. */
  readonly id: string;
  readonly type: UsageEventType;
  /** ISO 8601 instant in UTC, e.g. 2026-08-10T21:14:22.000Z */
  readonly ts_utc: string;
  /** ISO 8601 with explicit offset, e.g. 2026-08-10T15:14:22.000-06:00 */
  readonly ts_local: string;
  /**
   * Who did it. Always a non-empty string - every auth mode resolves to a
   * defined value, including "User", "Unknown User", "Unauthenticated User"
   * and "System". Never null, never empty.
   */
  readonly actor: string;
  readonly modelId?: string;
  readonly detail?: UsageEventDetail;
}
