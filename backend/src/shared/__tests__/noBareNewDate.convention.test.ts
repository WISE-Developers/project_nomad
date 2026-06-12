/**
 * Convention test — bans risky `new Date(<arg>)` shapes.
 *
 * Background: #273 (TZ double-adjust) was caused by `new Date(stringArg)`
 * silently parsing bare timestamps against the server's local zone. After
 * landing the fix, we catch regressions at test time.
 *
 * Rule: a line that contains `new Date(` is OK only if it ALSO contains one of:
 *   - `new Date()`            (no-arg current time)
 *   - `Date.UTC`              (explicit UTC math)
 *   - `Date.now()`            (epoch math)
 *   - `.getTime()`            (Date copy via epoch)
 *   - `Math.min(` / `Math.max(`  (epoch picker)
 *   - a numeric-literal argument
 *   - a trailing `// new-date-allowed: <reason>` annotation
 *
 * Anything else MUST use `parseIsoToDate`, `parseDbTimestamp`, or a
 * `DateTime.fromXxx(s, { zone })` Luxon call instead.
 *
 * Doc-comment lines (` *` and `//`) are stripped first.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC_ROOT = join(__dirname, '..', '..');
const BACKEND_ROOT = join(SRC_ROOT, '..');

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules' || entry === 'dist') continue;
      walk(full, acc);
    } else if (entry.endsWith('.test.ts')) {
      continue;
    } else if (entry.endsWith('.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

function isCommentLine(rawLine: string): boolean {
  const trimmed = rawLine.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*');
}

const SAFE_SUBSTRINGS = [
  'new Date()',
  'Date.UTC',
  'Date.now()',
  '.getTime()',
  'Math.min(',
  'Math.max(',
];

function isAllowed(line: string): boolean {
  if (line.includes('// new-date-allowed:')) return true;
  if (SAFE_SUBSTRINGS.some((s) => line.includes(s))) return true;
  // Numeric-literal arg, e.g. `new Date(1700000000000)` or `new Date(1_000)`.
  if (/new\s+Date\(\s*-?\d[\d_]*\s*\)/.test(line)) return true;
  return false;
}

describe('convention: every new Date(...) in backend/src is on an allow-list', () => {
  const files = walk(SRC_ROOT);
  const offenders: { file: string; line: number; text: string }[] = [];

  for (const file of files) {
    const lines = readFileSync(file, 'utf-8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (isCommentLine(raw)) continue;
      if (!raw.includes('new Date(')) continue;
      if (isAllowed(raw)) continue;
      offenders.push({ file: relative(BACKEND_ROOT, file), line: i + 1, text: raw.trim() });
    }
  }

  it('finds zero offending new Date(...) call sites', () => {
    if (offenders.length > 0) {
      const formatted = offenders
        .map((o) => `  ${o.file}:${o.line}\n    ${o.text}`)
        .join('\n');
      throw new Error(
        `Found ${offenders.length} risky \`new Date(...)\` call site(s). ` +
        `Use parseIsoToDate / parseDbTimestamp / Luxon DateTime.fromXxx(s, { zone }) instead, ` +
        `or annotate with a trailing \`// new-date-allowed: <reason>\` comment.\n\n${formatted}`,
      );
    }
    expect(offenders.length).toBe(0);
  });
});
