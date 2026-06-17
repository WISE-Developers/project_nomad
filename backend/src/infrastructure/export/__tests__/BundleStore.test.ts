import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EphemeralBundleCache } from '../BundleStore.js';
import type { ExportBundle } from '../types.js';
import { createFireModelId } from '../../../domain/entities/index.js';

function makeBundle(id: string, createdAt: Date): ExportBundle {
  return {
    id,
    modelId: createFireModelId('model-1'),
    items: [],
    manifest: {
      modelName: 'm',
      modelId: createFireModelId('model-1'),
      createdAt: createdAt.toISOString(),
      itemCount: 0,
      totalSize: 0,
      items: [],
    },
    createdAt,
  };
}

describe('EphemeralBundleCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores and retrieves a bundle by id', () => {
    const cache = new EphemeralBundleCache();
    const bundle = makeBundle('a', new Date());
    cache.put(bundle);
    expect(cache.get('a')).toBe(bundle);
    expect(cache.get('missing')).toBeUndefined();
  });

  it('does NOT start a timer merely by being constructed', () => {
    const spy = vi.spyOn(global, 'setInterval');
    new EphemeralBundleCache();
    expect(spy).not.toHaveBeenCalled();
  });

  it('start() begins the eviction interval; importing/constructing alone does not', () => {
    const spy = vi.spyOn(global, 'setInterval');
    const cache = new EphemeralBundleCache();
    expect(spy).not.toHaveBeenCalled();
    cache.start();
    expect(spy).toHaveBeenCalledTimes(1);
    cache.stop();
  });

  it('sweep() evicts bundles older than the TTL and keeps fresh ones', () => {
    const cache = new EphemeralBundleCache({ ttlMs: 1000 });
    const now = Date.now();
    vi.setSystemTime(now);

    const old = makeBundle('old', new Date(now - 2000));
    const fresh = makeBundle('fresh', new Date(now));
    cache.put(old);
    cache.put(fresh);

    cache.sweep();

    expect(cache.get('old')).toBeUndefined();
    expect(cache.get('fresh')).toBe(fresh);
  });

  it('start() drives eviction deterministically via fake timers', () => {
    const cache = new EphemeralBundleCache({ ttlMs: 1000, sweepIntervalMs: 500 });
    const now = Date.now();
    vi.setSystemTime(now);

    const old = makeBundle('old', new Date(now - 2000));
    cache.put(old);
    cache.start();
    // present until the first scheduled sweep fires
    expect(cache.get('old')).toBe(old);

    vi.advanceTimersByTime(500);

    expect(cache.get('old')).toBeUndefined();
    cache.stop();
  });

  it('stop() clears the interval so no further sweeps run', () => {
    const clearSpy = vi.spyOn(global, 'clearInterval');
    const cache = new EphemeralBundleCache();
    cache.start();
    cache.stop();
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });
});
