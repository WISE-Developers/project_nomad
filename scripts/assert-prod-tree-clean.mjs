#!/usr/bin/env node
/**
 * Assert that no development package reached the production dependency tree.
 *
 * Issue #389. The production image shipped vite 6.4.3 and rollup with nothing
 * depending on them, because `npm ci --omit=dev --omit=peer` does not remove
 * packages the lockfile marks `devOptional` — npm uses that flag when a package
 * is reachable both as a dev dependency and through an optional path, and only
 * `--omit=optional` drops it. `typescript` (plain `dev`) was removed; `vite` was
 * not.
 *
 * The check this replaces asserted the absence of four packages by name. It was
 * written after #382 and passed while vite sat in the tree, because a name list
 * is a snapshot of what someone thought to look for. This derives the set from
 * the lockfile instead, so the class is checked rather than the sample, and it
 * needs no maintenance as dependencies change.
 *
 * Usage:  node assert-prod-tree-clean.mjs [dir]     (dir defaults to cwd)
 *
 * Contract — deliberately three-state, so "rejected your input" is
 * distinguishable from "blew up":
 *
 *   exit 0   tree is clean          prints  PROD TREE CLEAN
 *   exit 1   dev packages present   prints  DIRTY  and every offender by name
 *   exit 2   bad input              prints  GUARD INPUT ERROR
 *
 * Exit 2 matters: a guard that passes because it could not find its input is
 * worse than no guard. Missing, unreadable or unparseable input fails loudly.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const EXIT_CLEAN = 0;
const EXIT_DIRTY = 1;
const EXIT_INPUT = 2;

function inputError(message) {
  console.error(`GUARD INPUT ERROR: ${message}`);
  process.exit(EXIT_INPUT);
}

const root = resolve(process.argv[2] ?? process.cwd());
const lockPath = join(root, 'package-lock.json');
const modulesPath = join(root, 'node_modules');

if (!existsSync(lockPath)) {
  inputError(`no package-lock.json at ${lockPath}`);
}
if (!existsSync(modulesPath) || !statSync(modulesPath).isDirectory()) {
  inputError(`no node_modules directory at ${modulesPath}`);
}

let lock;
try {
  lock = JSON.parse(readFileSync(lockPath, 'utf8'));
} catch (err) {
  inputError(`package-lock.json is not valid JSON — ${err.message}`);
}

const packages = lock?.packages;
if (!packages || typeof packages !== 'object') {
  inputError('package-lock.json has no "packages" object (lockfileVersion 2 or 3 required)');
}

const PREFIX = 'node_modules/';

/**
 * Top-level entries only. `node_modules/foo/node_modules/vite` is nested inside
 * foo — it is not a hoisted top-level vite, and reporting it as one would be a
 * false positive on a tree that is actually fine.
 */
const devPackages = [];
for (const [key, entry] of Object.entries(packages)) {
  if (!key.startsWith(PREFIX)) continue;
  const name = key.slice(PREFIX.length);
  if (name.includes(PREFIX)) continue;
  if (entry?.dev || entry?.devOptional) devPackages.push(name);
}

const present = devPackages.filter((name) => existsSync(join(modulesPath, name))).sort();

if (present.length > 0) {
  console.error(
    `DIRTY: ${present.length} development package(s) reached the production tree:`
  );
  for (const name of present) console.error(`  ${name}`);
  console.error('');
  console.error('The lockfile marks these dev or devOptional. A devOptional package');
  console.error('survives --omit=dev; it needs --omit=optional as well. See #389.');
  process.exit(EXIT_DIRTY);
}

console.log(
  `PROD TREE CLEAN: ${devPackages.length} dev/devOptional package(s) checked, none present.`
);
process.exit(EXIT_CLEAN);
