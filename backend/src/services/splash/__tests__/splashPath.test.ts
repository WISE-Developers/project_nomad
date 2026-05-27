/**
 * Tests for splash file path resolution (refs #275).
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { resolveSplashPath, DEFAULT_SPLASH_PATH } from '../splashPath.js';

describe('resolveSplashPath', () => {
  it('returns NOMAD_SPLASH_PATH when set', () => {
    expect(resolveSplashPath({ NOMAD_SPLASH_PATH: '/etc/nomad/splash.md' }))
      .toBe('/etc/nomad/splash.md');
  });

  it('falls back to NOMAD_DATA_PATH/splash.md when NOMAD_SPLASH_PATH not set', () => {
    expect(resolveSplashPath({ NOMAD_DATA_PATH: '/var/nomad' }))
      .toBe(path.join('/var/nomad', 'splash.md'));
  });

  it('prefers NOMAD_SPLASH_PATH over NOMAD_DATA_PATH', () => {
    expect(resolveSplashPath({
      NOMAD_SPLASH_PATH: '/explicit/splash.md',
      NOMAD_DATA_PATH: '/data',
    })).toBe('/explicit/splash.md');
  });

  it('falls back to bundled default when neither env var set', () => {
    expect(resolveSplashPath({})).toBe(DEFAULT_SPLASH_PATH);
  });

  it('DEFAULT_SPLASH_PATH points at backend/data/default-splash.md', () => {
    expect(DEFAULT_SPLASH_PATH).toMatch(/default-splash\.md$/);
  });
});
