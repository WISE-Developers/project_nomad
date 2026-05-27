/**
 * Parse a splash markdown file with YAML frontmatter into structured fields.
 *
 * Expected format:
 *
 *   ---
 *   title: Welcome to Nomad
 *   ---
 *
 *   ## Body content as markdown
 *
 * Returns null if the frontmatter is missing or required fields (title)
 * are absent. The parser is intentionally tiny — fixed `---` fences, simple
 * `key: value` lines, optional surrounding quotes.
 */

export interface SplashContent {
  title: string;
  body: string;
}

const FENCE = '---';

export function parseSplashFile(raw: string): SplashContent | null {
  const lines = raw.split(/\r?\n/);
  if (lines[0] !== FENCE) return null;

  const fields: Record<string, string> = {};
  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line === FENCE) break;
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }
  if (i >= lines.length) return null; // never closed

  const title = fields.title;
  if (!title) return null;

  const body = lines.slice(i + 1).join('\n').replace(/^\n+/, '');
  return { title, body };
}
