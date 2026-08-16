import type { IUsageLogger } from '../../application/interfaces/IUsageLogger.js';
import { JsonlUsageLogger, createJsonlUsageLogger } from './JsonlUsageLogger.js';

export { JsonlUsageLogger, createJsonlUsageLogger };

/**
 * Process-wide usage logger.
 *
 * The repo has no DI container, so adapters are wired as lazy singletons at
 * their call sites - the same shape as createFileSystemFuelDatasetCatalog in
 * routes/v1/index.ts. Constructed on first use rather than at import so that
 * importing this module has no filesystem side effect.
 */
let instance: IUsageLogger | null = null;

export function getUsageLogger(): IUsageLogger {
  if (!instance) {
    instance = createJsonlUsageLogger();
  }
  return instance;
}

/** Replaces the singleton. For tests and for composing a different adapter. */
export function setUsageLogger(logger: IUsageLogger | null): void {
  instance = logger;
}
