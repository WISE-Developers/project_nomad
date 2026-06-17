/**
 * Bundle Store
 *
 * Ephemeral, in-memory cache for export bundles.
 *
 * Bundles are short-lived download artifacts. This cache encapsulates the
 * backing Map, TTL-based eviction, and the lifecycle of the sweep timer.
 *
 * IMPORTANT: No timer is started at import or construction time. The eviction
 * interval only runs after an explicit `start()` call (wired into server
 * bootstrap) and is torn down by `stop()`.
 */

import type { ExportBundle } from './types.js';

/** Bundles older than this are evicted by the sweep. */
const DEFAULT_BUNDLE_TTL_MS = 60 * 60 * 1000; // 1 hour
/** How often the sweep runs once started. */
const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export interface EphemeralBundleCacheOptions {
  ttlMs?: number;
  sweepIntervalMs?: number;
}

/**
 * Ephemeral in-memory cache for export bundles with explicit TTL sweeping.
 */
export class EphemeralBundleCache {
  private readonly bundles = new Map<string, ExportBundle>();
  private readonly ttlMs: number;
  private readonly sweepIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: EphemeralBundleCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_BUNDLE_TTL_MS;
    this.sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    // Deliberately NO timer started here.
  }

  /** Store a bundle for later retrieval. */
  put(bundle: ExportBundle): void {
    this.bundles.set(bundle.id, bundle);
  }

  /** Retrieve a stored bundle by id, or undefined if absent. */
  get(bundleId: string): ExportBundle | undefined {
    return this.bundles.get(bundleId);
  }

  /** Evict bundles older than the TTL. Safe to call at any time. */
  sweep(): void {
    const now = Date.now();
    for (const [id, bundle] of this.bundles) {
      if (now - bundle.createdAt.getTime() > this.ttlMs) {
        this.bundles.delete(id);
      }
    }
  }

  /** Begin periodic eviction. Idempotent: a second call is a no-op. */
  start(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => this.sweep(), this.sweepIntervalMs);
    // Do not keep the event loop alive solely for the sweep.
    if (typeof this.timer === 'object' && this.timer && 'unref' in this.timer) {
      (this.timer as { unref: () => void }).unref();
    }
  }

  /** Stop periodic eviction and clear the timer. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

/**
 * Process-wide singleton bundle cache.
 * Stored on the module so all callers share one store.
 */
let cacheInstance: EphemeralBundleCache | null = null;

/** Get (or lazily create) the shared bundle cache. */
export function getBundleStore(): EphemeralBundleCache {
  if (cacheInstance === null) {
    cacheInstance = new EphemeralBundleCache();
  }
  return cacheInstance;
}
