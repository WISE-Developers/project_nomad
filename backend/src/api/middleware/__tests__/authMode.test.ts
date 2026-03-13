import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveAuthMode } from '../authMode.js';

describe('resolveAuthMode', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.NOMAD_AUTH_MODE;
    delete process.env.VITE_SIMPLE_AUTH;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns "none" when no env vars are set', () => {
    expect(resolveAuthMode()).toBe('none');
  });

  it('returns "simple" when NOMAD_AUTH_MODE=simple', () => {
    process.env.NOMAD_AUTH_MODE = 'simple';
    expect(resolveAuthMode()).toBe('simple');
  });

  it('returns "oauth" when NOMAD_AUTH_MODE=oauth', () => {
    process.env.NOMAD_AUTH_MODE = 'oauth';
    expect(resolveAuthMode()).toBe('oauth');
  });

  it('returns "none" when NOMAD_AUTH_MODE=none', () => {
    process.env.NOMAD_AUTH_MODE = 'none';
    expect(resolveAuthMode()).toBe('none');
  });

  it('is case-insensitive', () => {
    process.env.NOMAD_AUTH_MODE = 'OAuth';
    expect(resolveAuthMode()).toBe('oauth');
  });

  it('throws on invalid mode value', () => {
    process.env.NOMAD_AUTH_MODE = 'invalid';
    expect(() => resolveAuthMode()).toThrow('Invalid NOMAD_AUTH_MODE="invalid"');
  });

  it('falls back to VITE_SIMPLE_AUTH=true as "simple"', () => {
    process.env.VITE_SIMPLE_AUTH = 'true';
    expect(resolveAuthMode()).toBe('simple');
  });

  it('falls back to VITE_SIMPLE_AUTH=false as "none"', () => {
    process.env.VITE_SIMPLE_AUTH = 'false';
    expect(resolveAuthMode()).toBe('none');
  });

  it('prefers NOMAD_AUTH_MODE over VITE_SIMPLE_AUTH', () => {
    process.env.NOMAD_AUTH_MODE = 'oauth';
    process.env.VITE_SIMPLE_AUTH = 'true';
    expect(resolveAuthMode()).toBe('oauth');
  });
});
