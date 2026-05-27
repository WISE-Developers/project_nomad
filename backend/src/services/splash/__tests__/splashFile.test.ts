/**
 * Tests for splash file parsing (refs #275).
 */

import { describe, it, expect } from 'vitest';
import { parseSplashFile } from '../splashFile.js';

describe('parseSplashFile', () => {
  it('parses YAML frontmatter (version, title) and returns body markdown', () => {
    const content = [
      '---',
      'version: 1.0.0',
      'title: Welcome to Nomad',
      '---',
      '',
      "## What's new",
      '- Item one',
      '',
    ].join('\n');

    const result = parseSplashFile(content);

    expect(result).not.toBeNull();
    expect(result!.version).toBe('1.0.0');
    expect(result!.title).toBe('Welcome to Nomad');
    expect(result!.body).toContain("## What's new");
    expect(result!.body).toContain('- Item one');
  });
});

describe('parseSplashFile — validation', () => {
  it('returns null when content has no frontmatter', () => {
    expect(parseSplashFile('# Just markdown, no frontmatter')).toBeNull();
  });

  it('returns null when version is missing', () => {
    const content = '---\ntitle: Hello\n---\nbody';
    expect(parseSplashFile(content)).toBeNull();
  });

  it('returns null when title is missing', () => {
    const content = '---\nversion: 1.0.0\n---\nbody';
    expect(parseSplashFile(content)).toBeNull();
  });

  it('returns null when frontmatter is malformed (no closing fence)', () => {
    const content = '---\nversion: 1.0.0\ntitle: Hello\nbody without close';
    expect(parseSplashFile(content)).toBeNull();
  });

  it('strips surrounding quotes from frontmatter values', () => {
    const content = '---\nversion: "1.2.3"\ntitle: "Quoted Title"\n---\nbody';
    const r = parseSplashFile(content);
    expect(r!.version).toBe('1.2.3');
    expect(r!.title).toBe('Quoted Title');
  });
});
