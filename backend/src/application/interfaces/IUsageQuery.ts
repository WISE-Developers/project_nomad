import type { UsageEvent, UsageEventType } from '../../domain/value-objects/UsageEvent.js';

export interface UsageQueryOptions {
  /** Maximum events to return. Always bounded by the caller. */
  limit: number;
  /** Only events at or after this ISO instant. */
  since?: string;
  /** Only events of these types. */
  types?: UsageEventType[];
}

export interface UsageQueryResult {
  events: UsageEvent[];
  /** Total matching events, so a caller knows the response was truncated. */
  total: number;
}

/**
 * Read side of the usage log (#332).
 *
 * Kept separate from IUsageLogger: almost everything in the app writes events
 * and nothing but the admin endpoint reads them, so the write contract should
 * not carry a read method. (Interface segregation.)
 */
export interface IUsageQuery {
  query(options: UsageQueryOptions): Promise<UsageQueryResult>;
}
