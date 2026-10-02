#!/usr/bin/env node
/**
 * Decode .fgmj files against the vendored WISE protobuf schema — groundwork for #294.
 *
 * The .fgmj is a protobuf JSON serialization (WISE's own validator names the
 * messages: CWFGM.PSaaS, CWFGM.ProjectProto.Project, ...). This proves the
 * vendored descriptor set models the format completely, and carries the one
 * transform that makes protobufjs able to read these files.
 *
 * Verified 2026-09-30 against 40 real fgmj files from five locations — every one
 * decoded, including a wire round-trip.
 *
 * Usage:
 *   node tools/fgmj-decode-check.mjs [file-or-directory ...]
 *
 * Defaults to test-data/. Exits non-zero if any file fails, so it can gate CI.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PRE-PASS EXISTS
 *
 * proto3 JSON serialises google.protobuf wrapper types as the BARE SCALAR:
 *
 *     message Double {                          // math.proto
 *         double value = 1;
 *         google.protobuf.DoubleValue error = 2;
 *         google.protobuf.StringValue hex = 3;   // emitted as "0x1.99..."
 *     }
 *     google.protobuf.Int32Value port = 2;       // emitted as 1883
 *
 * That is correct proto3 JSON, but protobufjs's fromObject expects {value: x}
 * for a message-typed field and rejects the scalar with "object expected".
 * Without this transform, ALL 40 sample files fail.
 *
 * The transform must be SCHEMA-GUIDED rather than a list of known wrapper
 * fields: across 40 files it fires ~88,657 times, so any hand-written list
 * would miss some. It walks field.resolvedType, so it covers wrapper fields
 * nobody has noticed yet.
 *
 * An alternative worth considering when this is productionised:
 * @bufbuild/protobuf implements proto3 JSON properly, including well-known
 * types, and needs no pre-pass at all.
 *
 * NOTE ON PLACEMENT: this lives in tools/ with protobufjs as a ROOT
 * devDependency deliberately. The importer is not built yet, and adding a
 * runtime dependency to the backend would put protobufjs in the production
 * image — which #389 has just finished cleaning up. Move it when the feature
 * is real.
 */

import fs from "node:fs";
import path from "node:path";
import protobuf from "protobufjs";
import descriptor from "protobufjs/ext/descriptor/index.js";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, "..");
const DESCRIPTOR_SET = path.join(REPO, "vendor", "wise-protos", "fgmj_descriptor_set.pb");
const ROOT_MESSAGE = ".WISE.ProjectProto.PrometheusData";

/** google.protobuf wrapper messages, which proto3 JSON writes as bare scalars. */
const WRAPPERS = new Set([
  "google.protobuf.DoubleValue", "google.protobuf.FloatValue",
  "google.protobuf.Int64Value", "google.protobuf.UInt64Value",
  "google.protobuf.Int32Value", "google.protobuf.UInt32Value",
  "google.protobuf.BoolValue", "google.protobuf.StringValue",
  "google.protobuf.BytesValue",
]);

export function loadSchema(descriptorPath = DESCRIPTOR_SET) {
  if (!fs.existsSync(descriptorPath)) {
    throw new Error(`descriptor set not found at ${descriptorPath}`);
  }
  const set = descriptor.FileDescriptorSet.decode(fs.readFileSync(descriptorPath));
  const root = protobuf.Root.fromDescriptor(set);
  root.resolveAll();
  return { root, Message: root.lookupType(ROOT_MESSAGE) };
}

/**
 * Rewrite proto3-JSON well-known-type shorthand into what protobufjs expects.
 * Returns undefined for null/undefined so the caller drops the key.
 */
export function normaliseForProtobufjs(value, type, stats = { wrapped: 0, dropped: 0 }) {
  if (value === null || value === undefined) { stats.dropped++; return undefined; }
  if (!type?.fields) return value;
  if (Array.isArray(value)) return value.map((v) => normaliseForProtobufjs(v, type, stats));

  if (typeof value !== "object") {
    // A scalar where a message is expected is legal ONLY for wrapper types.
    // Anything else is left alone so verify() reports it rather than this
    // function silently inventing a shape.
    if (WRAPPERS.has(type.fullName.replace(/^\./, ""))) { stats.wrapped++; return { value }; }
    return value;
  }

  const out = {};
  for (const [key, v] of Object.entries(value)) {
    const field = type.fields[key] ?? Object.values(type.fields).find((f) => f.name === key);
    if (!field) { out[key] = v; continue; }   // unknown field: let verify() flag it
    const sub = field.resolvedType?.fields ? field.resolvedType : null;
    const nv = normaliseForProtobufjs(v, sub, stats);
    if (nv !== undefined) out[key] = nv;
  }
  return out;
}

/** Decode one file. Throws with a message naming the offending path on failure. */
export function decodeFgmj(file, schema = loadSchema(), stats) {
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  const clean = normaliseForProtobufjs(json, schema.Message, stats);
  const message = schema.Message.fromObject(clean);
  const err = schema.Message.verify(schema.Message.toObject(message));
  if (err) throw new Error(err);
  // Wire round-trip: proves the schema models the file, not merely that it
  // survived validation.
  schema.Message.decode(schema.Message.encode(message).finish());
  return message;
}

function collect(target, out = []) {
  const st = fs.statSync(target);
  if (st.isFile()) { if (/\.fgmj$/i.test(target) && !path.basename(target).startsWith("._")) out.push(target); return out; }
  for (const e of fs.readdirSync(target, { withFileTypes: true })) {
    const p = path.join(target, e.name);
    if (e.isDirectory()) collect(p, out);
    else if (/\.fgmj$/i.test(e.name) && !e.name.startsWith("._")) out.push(p);
  }
  return out;
}

function main(argv) {
  const targets = argv.length ? argv : [path.join(REPO, "test-data")];
  const schema = loadSchema();
  const files = targets.flatMap((t) => (fs.existsSync(t) ? collect(t) : []));

  if (!files.length) { console.error("no .fgmj files found in:", targets.join(", ")); return 1; }

  const stats = { wrapped: 0, dropped: 0 };
  let ok = 0;
  const failures = [];

  for (const f of files) {
    try { decodeFgmj(f, schema, stats); ok++; console.log(`  ok   ${path.relative(REPO, f)}`); }
    catch (e) { failures.push([f, String(e.message || e)]); console.log(`  FAIL ${path.relative(REPO, f)}\n       ${String(e.message || e).slice(0, 140)}`); }
  }

  console.log(`\n${ok}/${files.length} decoded (scalars wrapped: ${stats.wrapped}, nulls dropped: ${stats.dropped})`);
  return failures.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
