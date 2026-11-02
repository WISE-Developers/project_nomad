/**
 * Convention test — an effect that sets state from a promise must stop at unmount (#505).
 *
 * Background. `Frontend on React 19` failed on PR #504 with 98 files and 806
 * tests all passing, on one unhandled rejection:
 *
 *   ReferenceError: window is not defined
 *    ❯ resolveUpdatePriority react-dom-client.development.js:1498
 *    ❯ dispatchSetState      react-dom-client.development.js:9512
 *
 * SplashScreen's OAuth effect set state in a promise continuation with no
 * cancellation guard. When the promise settled after teardown, react-dom
 * reached for `window` in a jsdom that was gone. It was non-deterministic — the
 * same commit failed and passed in two runs — so it surfaced as a rare flake
 * landing on whoever was merging something unrelated.
 *
 * WHY A CONVENTION TEST AND NOT ONLY A BEHAVIOURAL ONE. Eight sibling effects
 * shared the shape, in eight different components. SplashScreen.unmount.test.tsx
 * pins the behaviour at the one site that actually fired; writing the same
 * test eight more times pins eight sites and still says nothing about the
 * ninth one somebody adds next month. The recurring failure here is not the
 * defect, it is "one was fixed and the rest were assumed fine" — twice in one
 * day, counting backend/Dockerfile, whose correct sibling sat in the same file.
 *
 * WHAT COUNTS AS A GUARD: a cancellation flag checked before the setter, or an
 * AbortController, plus a cleanup function. Both halves are required — guards
 * with no cleanup leave a flag that is never set, which is a guard that cannot
 * fire. (That happened while fixing these very sites: OutputPreviewModal got
 * its `if (cancelled) return` checks and no `return () => ...`, and the flag
 * could never become true.)
 *
 * COMMENTS ARE STRIPPED FIRST. The scan that found these sites reported
 * openNomad/context/useOpenNomad.ts as a tenth offender; its only `useEffect`
 * text is inside an `@example` JSDoc block and the file does not even import
 * useEffect. A scanner that reads comments as code manufactures work.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');

/** Sites deliberately exempt, each with the reason it cannot set state late. */
const ALLOWLIST: Record<string, string> = {
  // (empty on purpose: every known site is guarded. An entry here must say WHY
  // the effect cannot set state after unmount — not that it is unlikely to.)
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.test\.tsx?$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

/** Remove block and line comments so JSDoc examples are not read as code. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

/** Bodies of every useEffect call, matched by brace balance. */
function effectBodies(source: string): string[] {
  const bodies: string[] = [];
  const re = /useEffect\(\s*\(\s*\)\s*=>\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    bodies.push(source.slice(start, i - 1));
  }
  return bodies;
}

const SETTER = /\bset[A-Z]\w*\s*\(/;
const ASYNC = /\.then\s*\(|\bawait\b/;
const GUARD = /\bcancelled\b|\bcancelled\b|\bisMounted\b|AbortController/;
const CLEANUP = /return\s*\(\s*\)\s*=>/;

describe('convention: async effects stop at unmount (#505)', () => {
  const offenders: string[] = [];

  for (const file of sourceFiles(SRC)) {
    const rel = file.slice(SRC.length + 1);
    if (rel in ALLOWLIST) continue;
    const stripped = stripComments(readFileSync(file, 'utf-8'));
    for (const body of effectBodies(stripped)) {
      if (!ASYNC.test(body)) continue;
      if (!SETTER.test(body)) continue;
      const guarded = GUARD.test(body) && CLEANUP.test(body);
      if (!guarded) {
        offenders.push(
          `${rel} — sets state from a promise with ` +
            `${GUARD.test(body) ? 'a guard but NO cleanup (the flag can never become true)' : 'no cancellation guard'}`,
        );
      }
    }
  }

  it('finds no effect that can set state after unmount', () => {
    expect(offenders).toEqual([]);
  });

  it('is actually looking at something (the scan is not vacuous)', () => {
    // If this ever reads 0, the scanner stopped finding effects at all and the
    // check above would pass for the wrong reason.
    let asyncEffectCount = 0;
    for (const file of sourceFiles(SRC)) {
      const stripped = stripComments(readFileSync(file, 'utf-8'));
      for (const body of effectBodies(stripped)) {
        if (ASYNC.test(body) && SETTER.test(body)) asyncEffectCount++;
      }
    }
    expect(asyncEffectCount).toBeGreaterThan(5);
  });
});
