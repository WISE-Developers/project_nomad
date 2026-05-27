import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { DEFAULT_SPLASH_PATH } from '../splashPath';
import { parseSplashFile } from '../splashFile';

describe('default-splash.md', () => {
  it('exists and parses cleanly', () => {
    expect(fs.existsSync(DEFAULT_SPLASH_PATH)).toBe(true);
    const raw = fs.readFileSync(DEFAULT_SPLASH_PATH, 'utf8');
    const parsed = parseSplashFile(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toBe('Welcome to Project Nomad');
    expect(parsed!.body.length).toBeGreaterThan(0);
  });
});
