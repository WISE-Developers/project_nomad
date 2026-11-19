/**
 * Every relative import in the BUILT output must resolve to a file on disk.
 *
 * WHY THIS EXISTS. On 2026-11-19 v0.66.0 crash-looped the CIFFC demo and took it down.
 * One import — `from './fuelGridLut'` — was missing its `.js`, and Node's ESM loader
 * refuses an extensionless specifier. The site was down until it was rolled back.
 *
 * ALL FOUR EXISTING GATES PASSED, and that is the part worth understanding. tsconfig
 * sets `"moduleResolution": "bundler"`, which permits extensionless specifiers, so:
 * `tsc --noEmit` was satisfied, vitest resolved it the same permissive way, eslint had
 * no opinion, and `npm run build` COMPILED it happily — emitting the specifier verbatim
 * for Node to reject later. Four green gates and a dead application, because none of
 * them ever STARTED the thing they built.
 *
 * So this checks the emitted artefact rather than the source, and it checks resolution
 * rather than syntax: for every `import`/`export ... from './x'` in dist, the target must
 * exist. That is the exact question Node asks at boot, asked earlier.
 *
 * Deliberately NOT a lint rule about writing `.js`: the defect is "the built app cannot
 * load", and a style rule would go on passing the day someone finds a new way to emit an
 * unresolvable path.
 */

import { readdir, readFile, access } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';

const DIST = resolve(process.argv[2] ?? 'dist');

/** `import ... from '<spec>'`, `export ... from '<spec>'`, and `import('<spec>')`. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.[^'"]*)['"]/g;

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else if (entry.name.endsWith('.js')) out.push(path);
  }
  return out;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const files = await walk(DIST);
if (files.length === 0) {
  console.error(`no .js files under ${DIST} — build first, or this check proves nothing`);
  process.exit(1);
}

const broken = [];
const brokenInCompiledTests = [];
let checked = 0;
for (const file of files) {
  const source = await readFile(file, 'utf-8');
  for (const match of source.matchAll(SPECIFIER)) {
    const spec = match[1];
    checked += 1;
    const target = resolve(dirname(file), spec);
    // Node will accept the exact file, or a directory with an index.js only under CJS —
    // this output is ESM, so the exact file is the only thing that loads.
    if (!(await exists(target))) {
      const rel = `${file.slice(DIST.length + 1)} -> ${spec}`;
      // COMPILED TEST FILES ARE COUNTED BUT DO NOT FAIL THIS CHECK, and they are
      // reported rather than filtered out of sight. The question here is "will the
      // built app start", and nothing at boot imports a `.test.js`. They are listed
      // because dist containing compiled tests at all is its own pre-existing oddity —
      // 13 of them had unresolvable imports on 2026-11-19 and had done for a while,
      // harmlessly. Silently dropping them would hide the day one stops being harmless.
      if (/(^|\/)__tests__\//.test(rel) || /\.test\.js /.test(`${rel} `)) {
        brokenInCompiledTests.push(rel);
      } else {
        broken.push(rel);
      }
    }
  }
}

// A zero here must mean "all resolved", never "nothing was looked at".
if (checked === 0) {
  console.error(`found ${files.length} files but ZERO relative imports — the matcher is dead`);
  process.exit(1);
}

if (brokenInCompiledTests.length > 0) {
  console.log(
    `note: ${brokenInCompiledTests.length} unresolvable import(s) in COMPILED TEST files ` +
      'under dist. Not a boot failure — nothing at startup imports a test — and ' +
      'pre-existing. Reported so it cannot disappear quietly:'
  );
  for (const line of brokenInCompiledTests) console.log(`  (test) ${line}`);
}

if (broken.length > 0) {
  console.error(
    `\nUNRESOLVABLE RELATIVE IMPORTS IN PRODUCTION CODE (${broken.length} of ${checked}):`
  );
  for (const line of broken) console.error(`  ${line}`);
  console.error('\nNode refuses an extensionless ESM specifier. The built app will NOT start.');
  console.error('This is the defect that took the CIFFC demo down on 2026-11-19.');
  process.exit(1);
}

console.log(
  `dist imports OK: ${checked} relative specifiers across ${files.length} files, ` +
    'every one reachable at boot resolves'
);
