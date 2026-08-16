import type { UsageEvent } from '../../domain/value-objects/UsageEvent.js';

/**
 * Port for recording usage events (#332).
 *
 * Call sites emit domain events and know nothing about where the log goes -
 * JSONL on a SAN laptop, a table in ACN, or a fake in tests.
 *
 * CONTRACT: recording must never fail the caller. A model run does not fail
 * because its usage event could not be written. Implementations therefore
 * swallow write errors from the caller's perspective - but must log them
 * loudly through the application logger. Silent loss is not acceptable; a log
 * that quietly stops recording is worse than one that was never added, because
 * its emptiness reads as "nothing happened".
 */
export interface IUsageLogger {
  /**
   * Records one event. Never throws.
   */
  record(event: UsageEvent): Promise<void>;
}
