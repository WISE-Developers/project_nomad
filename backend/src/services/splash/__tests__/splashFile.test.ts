import { describe, it, expect } from 'vitest';
import { parseSplashFile } from '../splashFile';

describe('parseSplashFile', () => {
  it('parses YAML frontmatter (title) and returns body markdown', () => {
    const content = [
      '---',
      'title: Hello Nomad',
      '---',
      '',
      '## Heading',
      '- bullet',
      '',
    ].join('\n');
    const result = parseSplashFile(content);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Hello Nomad');
    expect(result!.body).toContain('## Heading');
  });

  it('returns null when frontmatter is missing entirely', () => {
    expect(parseSplashFile('# just a heading')).toBeNull();
  });

  it('returns null when title is missing', () => {
    const content = '---\nfoo: bar\n---\nbody';
    expect(parseSplashFile(content)).toBeNull();
  });

  it('returns null when closing fence is missing', () => {
    const content = '---\ntitle: Hello\nbody without close';
    expect(parseSplashFile(content)).toBeNull();
  });

  it('strips surrounding quotes around values', () => {
    const content = '---\ntitle: "Quoted Title"\n---\nbody';
    const r = parseSplashFile(content);
    expect(r!.title).toBe('Quoted Title');
  });
});
