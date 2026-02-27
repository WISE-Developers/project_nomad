/**
 * Validate that dist/ contains a library build (openNomad), not an app build.
 * Run automatically by `npm run tarball` before `npm pack`.
 *
 * Required files:  openNomad.js, openNomad.umd.cjs, index.d.ts, style.css
 * Forbidden files: index.html, sw.js, manifest.json (app build artifacts)
 */

import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = resolve(__dirname, '..', 'dist');

const required = [
  'openNomad.js',
  'openNomad.umd.cjs',
  'index.d.ts',
  'style.css',
];

const forbidden = [
  'index.html',
  'sw.js',
  'manifest.json',
];

let failed = false;

for (const file of required) {
  if (!existsSync(resolve(dist, file))) {
    console.error(`MISSING: dist/${file}`);
    failed = true;
  }
}

for (const file of forbidden) {
  if (existsSync(resolve(dist, file))) {
    console.error(`UNEXPECTED: dist/${file} — this is an app build, not a library build. Run "npm run build:lib" instead of "npm run build".`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log('Tarball validation passed — library build confirmed.');
