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
