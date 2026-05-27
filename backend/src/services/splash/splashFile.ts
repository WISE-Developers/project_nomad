/**
 * Splash file parser (refs #275).
 *
 * Parses a markdown document with YAML frontmatter of the form:
 *
 *   ---
 *   version: 1.0.0
 *   title: Welcome
 *   ---
 *   <markdown body>
 *
 * Returns null if the frontmatter is missing or required fields (version,
 * title) are absent. We use a tiny zero-dep parser because the grammar is
 * fixed and we want to avoid pulling in gray-matter for a few KB of YAML.
 */

export interface SplashContent {
  version: string;
  title: string;
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function parseFrontmatterFields(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    // Strip surrounding quotes if present.
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

export function parseSplashFile(content: string): SplashContent | null {
  const match = FRONTMATTER_RE.exec(content);
  if (!match) return null;

  const fields = parseFrontmatterFields(match[1]);
  const version = fields.version;
  const title = fields.title;
  if (!version || !title) return null;

  const body = (match[2] ?? '').replace(/^\r?\n/, '');
  return { version, title, body };
}
