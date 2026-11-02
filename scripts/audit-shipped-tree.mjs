#!/usr/bin/env node
/**
 * Fail the build on a critical or high advisory in the tree that SHIPS (#499).
 *
 * WHY. The per-package currency tests guard six packages with hand-typed
 * ceilings, and two of them went stale while hiding a live advisory:
 * betterAuthCurrency sat at 1.6.21 through a CRITICAL auth bypass, and
 * multerCurrency sat at 2.2.0 — below the installed version — over a live HIGH.
 * Both were green the whole time. A ceiling that must be remembered is a guard
 * that stops guarding, so this derives from the advisory database instead.
 *
 * WHAT "SHIPS" MEANS, and why it is not `npm audit`.
 *
 *   npm audit                     the whole dev tree — not what ships
 *   npm audit --omit=dev          still reports vite and vitest, which are
 *                                 provably absent from the image, because
 *                                 --omit=dev drops only entries flagged `dev`
 *                                 and a devOptional entry survives it
 *   --omit=dev --omit=peer --omit=optional
 *                                 what backend/Dockerfile actually prunes with
 *
 * So this uses the Dockerfile's three flags verbatim. Sharing the definition is
 * the point: a second definition of "shipped" is how two measurements drift
 * apart and one of them starts lying.
 *
 * WHAT THIS STILL DOES NOT SEE. The browser bundle. Frontend code ships
 * COMPILED, not installed, so a dependency that is bundled into
 * frontend/dist — dompurify via jspdf, for instance — appears in no
 * node_modules audit of the production tree. That cost a wrong report: the
 * backend tree was measured and the answer generalised to "shipped".
 * Frontend-only advisories need their own check against the built assets, and
 * this gate does not provide one.
 *
 * ALSO NOT SEEN: the Dockerfile deletes node_modules/node-gyp and the hoisted
 * node_modules/tar after installing (#379), so a finding here may already be
 * pruned from the image. That makes this gate CONSERVATIVE — it can fail on
 * something that does not ship — which is the safe direction. The allowlist is
 * where such a case is recorded, with its reason.
 *
 * Usage:
 *   node scripts/audit-shipped-tree.mjs
 *   node scripts/audit-shipped-tree.mjs --input audit.json --allowlist file.json
 *
 * --input exists so the gate's own behaviour can be tested against recorded
 * documents. A test that queried the live database would change its verdict
 * when the world changed, making it a measurement of npm rather than of this.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const FAIL_AT = new Set(['critical', 'high']);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** The Dockerfile's own prune flags. Changing these forks the definition. */
const OMIT_FLAGS = ['--omit=dev', '--omit=peer', '--omit=optional'];

function readAudit(inputPath) {
  if (inputPath) return JSON.parse(readFileSync(inputPath, 'utf8'));
  // npm audit exits non-zero when it finds anything, so the throw carries the
  // payload. Treating a non-zero exit as failure would make the gate unable to
  // report what it found.
  try {
    const out = execFileSync('npm', ['audit', ...OMIT_FLAGS, '--json'], {
      cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    return JSON.parse(out);
  } catch (e) {
    if (e.stdout) return JSON.parse(e.stdout);
    throw e;
  }
}

function readAllowlist(p) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return { allow: [], missing: true };
  }
  return raw;
}

const auditPath = arg('--input', null);
const allowPath = arg('--allowlist', join(REPO, '.audit-allowlist.json'));

const audit = readAudit(auditPath);
const allowlist = readAllowlist(allowPath);
const allow = Array.isArray(allowlist.allow) ? allowlist.allow : [];

// An entry without a reason is not an exception, it is an omission. And an
// entry with no review date is permanent by default, which is how a temporary
// suppression becomes the status quo.
const malformed = allow.filter((e) => !e || !e.package || !e.reason || !e.review_by);
const today = new Date().toISOString().slice(0, 10);
const expired = allow.filter((e) => e && e.review_by && e.review_by < today);
const usable = new Map(
  allow
    .filter((e) => e && e.package && e.reason && e.review_by && e.review_by >= today)
    .map((e) => [e.package, e]),
);

const vulns = Object.entries(audit.vulnerabilities || {});
const blocking = [];
const suppressed = [];
for (const [name, v] of vulns) {
  if (!FAIL_AT.has(v.severity)) continue;
  if (usable.has(name)) suppressed.push({ name, v, entry: usable.get(name) });
  else blocking.push({ name, v });
}

// A stale allowlist entry is the #499 defect pointed at this gate: a
// hand-maintained exception that outlives the advisory it was written for, with
// nothing to say so. Report it rather than letting it become permanent.
const present = new Set(vulns.map(([n]) => n));
const stale = allow.filter((e) => e && e.package && !present.has(e.package));

const order = { critical: 0, high: 1 };
blocking.sort((a, b) => order[a.v.severity] - order[b.v.severity] || a.name.localeCompare(b.name));

console.log(`Shipped-tree advisory gate — npm audit ${OMIT_FLAGS.join(' ')}`);
console.log(`  advisories in the production tree: ${vulns.length}`);
console.log(`  blocking (critical/high, not allowlisted): ${blocking.length}`);

for (const { name, v } of blocking) {
  console.log(`\n  ${v.severity.toUpperCase()}  ${name}`);
  console.log(`    vulnerable range: ${v.range}`);
  const titles = (v.via || []).filter((x) => x && typeof x === 'object').slice(0, 3);
  for (const t of titles) console.log(`    ${t.title || ''} ${t.url || ''}`.trimEnd());
}

for (const { name, v, entry } of suppressed) {
  console.log(`\n  allowlisted: ${name} (${v.severity}) — ${entry.reason} [review by ${entry.review_by}]`);
}

if (stale.length) {
  console.log(`\n  STALE ALLOWLIST — ${stale.length} entr${stale.length === 1 ? 'y' : 'ies'} matches nothing in the audit:`);
  for (const e of stale) console.log(`    ${e.package} — "${e.reason}". Remove it; the advisory it suppressed is gone.`);
}

let bad = false;
if (allowlist.missing) {
  console.log(`\n  note: no allowlist at ${allowPath} — treating it as empty.`);
}
if (malformed.length) {
  console.log(`\n  MALFORMED ALLOWLIST — every entry needs package, reason and review_by:`);
  for (const e of malformed) console.log(`    ${JSON.stringify(e)}`);
  bad = true;
}
if (expired.length) {
  console.log(`\n  EXPIRED ALLOWLIST — these no longer suppress anything:`);
  for (const e of expired) console.log(`    ${e.package} — review_by ${e.review_by} has passed. Re-check upstream and move the date, or fix it.`);
  bad = true;
}
if (blocking.length) bad = true;

console.log('');
if (bad) {
  console.log(`FAIL — ${blocking.length} blocking advisor${blocking.length === 1 ? 'y' : 'ies'} in the shipped tree.`);
  process.exit(1);
}
console.log('PASS — no unallowlisted critical or high advisory in the shipped tree.');
