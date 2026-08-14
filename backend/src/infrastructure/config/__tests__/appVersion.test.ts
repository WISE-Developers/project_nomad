import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveAppVersion } from '../appVersion.js';

/**
 * Application version resolution.
 *
 * Both previous call sites used `process.env.npm_package_version || '<fake>'`.
 * npm_package_version is only set when a process is launched via npm, and the
 * container runs `node dist/index.js` directly - so in every real deployment
 * the fallback won.
 *
 * The result was a service that answered version questions with a fabricated
 * number: /api/v1/info reported "1.0.0" on a box running v0.12.1, in production,
 * for a long time. It did not fail; it answered. That is what made it durable.
 *
 * The version is NOT optional: a service that cannot say what it is should not
 * serve.
 */
describe('resolveAppVersion', () => {
  const original = process.env.NOMAD_VERSION;

  beforeEach(() => {
    delete process.env.NOMAD_VERSION;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.NOMAD_VERSION;
    else process.env.NOMAD_VERSION = original;
  });

  it('returns the injected version when set', () => {
    process.env.NOMAD_VERSION = '0.12.1';
    expect(resolveAppVersion()).toBe('0.12.1');
  });

  it('throws rather than substituting a placeholder when unset', () => {
    expect(() => resolveAppVersion()).toThrow(/NOMAD_VERSION/);
  });

  it('never returns 1.0.0 or 0.0.0 as a fallback', () => {
    let result: string | undefined;
    try {
      result = resolveAppVersion();
    } catch {
      result = undefined;
    }
    expect(result).not.toBe('1.0.0');
    expect(result).not.toBe('0.0.0');
    expect(result).toBeUndefined();
  });

  it('rejects an empty or whitespace-only version', () => {
    process.env.NOMAD_VERSION = '   ';
    expect(() => resolveAppVersion()).toThrow();
  });

  it('rejects a value that is not a version number', () => {
    process.env.NOMAD_VERSION = 'unknown';
    expect(() => resolveAppVersion()).toThrow(/unknown/);
  });

  it('accepts a pre-release version such as a dev build', () => {
    process.env.NOMAD_VERSION = '0.12.1-dev.2';
    expect(resolveAppVersion()).toBe('0.12.1-dev.2');
  });

  it('trims surrounding whitespace', () => {
    process.env.NOMAD_VERSION = '  0.12.1  ';
    expect(resolveAppVersion()).toBe('0.12.1');
  });

  it('does not read npm_package_version — it is unset in every container', () => {
    process.env.npm_package_version = '9.9.9';
    try {
      expect(() => resolveAppVersion()).toThrow();
    } finally {
      delete process.env.npm_package_version;
    }
  });
});
