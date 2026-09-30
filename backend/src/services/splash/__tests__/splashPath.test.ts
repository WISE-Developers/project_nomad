/**
 * Tests for resolveSplashPath (refs #275).
 *
 * Precedence-only: NOMAD_SPLASH_PATH overrides everything, otherwise
 * the bundled default file path is returned.
 */

import { describe, it, expect } from 'vitest';
import { resolveSplashPath, DEFAULT_SPLASH_PATH, type SplashEnv } from '../splashPath';

describe('resolveSplashPath', () => {
  it('returns NOMAD_SPLASH_PATH when set', () => {
    const p = resolveSplashPath({ NOMAD_SPLASH_PATH: '/etc/nomad/custom-splash.md' });
    expect(p).toBe('/etc/nomad/custom-splash.md');
  });

  it('returns the bundled default when no override is set', () => {
    const p = resolveSplashPath({});
    expect(p).toBe(DEFAULT_SPLASH_PATH);
  });

  it('does not derive from NOMAD_DATA_PATH (data vs config separation)', () => {
    // NOMAD_DATA_PATH is for runtime data (sims, db, outputs) and must never
    // be used as a splash content source. SplashEnv does not declare the key,
    // so the cast is what lets us feed it in and prove it is ignored.
    const p = resolveSplashPath({ NOMAD_DATA_PATH: '/var/nomad/data' } as unknown as SplashEnv);
    expect(p).toBe(DEFAULT_SPLASH_PATH);
  });

  it('DEFAULT_SPLASH_PATH points to the colocated assets/default-splash.md', () => {
    expect(DEFAULT_SPLASH_PATH).toMatch(/[\\/]assets[\\/]default-splash\.md$/);
  });
});
