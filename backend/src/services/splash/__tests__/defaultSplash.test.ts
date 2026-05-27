/**
 * Smoke test: the bundled default-splash.md is well-formed (#275).
 *
 * Guards against accidentally shipping a default file the parser rejects —
 * which would cause the disabled-fallback to silently fire in deployments
 * that rely on the bundled default.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { parseSplashFile } from '../splashFile.js';
import { DEFAULT_SPLASH_PATH } from '../splashPath.js';

describe('default-splash.md', () => {
  it('exists and parses to a valid SplashContent', () => {
    const raw = fs.readFileSync(DEFAULT_SPLASH_PATH, 'utf8');
    const parsed = parseSplashFile(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.version).toBe('1.0.0');
    expect(parsed!.title).toBe('Welcome to Project Nomad');
    expect(parsed!.body).toContain("## What's new");
  });
});
