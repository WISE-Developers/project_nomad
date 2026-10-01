/**
 * Load and decode a Prometheus/WISE .fgmj project file (refs #294).
 *
 * The .fgmj is a protobuf JSON serialization, so it is decoded against the
 * vendored descriptor set rather than read as loose JSON. That buys schema
 * validation for free: a file whose shape the schema does not model fails here
 * instead of producing a half-populated model that runs and burns wrongly.
 *
 * Import policy throughout is STOP AND ALERT. No silent defaults, no partial
 * import, and every failure names the file it came from — an importer is run
 * over directories of other people's files, and "it didn't work" without a
 * filename is not actionable.
 */

import fs from 'fs';
import path from 'path';
import { loadFgmjSchema } from './fgmjSchema.js';

/** google.protobuf wrapper messages, which proto3 JSON writes as bare scalars. */
const WRAPPER_TYPES = new Set([
  'google.protobuf.DoubleValue',
  'google.protobuf.FloatValue',
  'google.protobuf.Int64Value',
  'google.protobuf.UInt64Value',
  'google.protobuf.Int32Value',
  'google.protobuf.UInt32Value',
  'google.protobuf.BoolValue',
  'google.protobuf.StringValue',
  'google.protobuf.BytesValue',
]);

/** A scenario as the importer needs it: one scenario becomes one FireSTARR model. */
export interface FgmjScenario {
  name: string;
  /** The raw decoded scenario, for resolution steps that come later. */
  raw: Record<string, unknown>;
}

/** The parts of a decoded project the importer resolves references against. */
export interface FgmjProject {
  scenarios: FgmjScenario[];
  ignitions: Record<string, unknown>[];
  stations: Record<string, unknown>[];
  weatherFilters: Record<string, unknown>[];
  /** The whole decoded project, for anything not yet surfaced above. */
  raw: Record<string, unknown>;
}

interface ProtoTypeLike {
  fullName: string;
  fields: Record<string, { name: string; resolvedType?: { fields?: unknown } | null }>;
}

/**
 * Rewrite proto3-JSON well-known-type shorthand into what protobufjs expects.
 *
 * proto3 serialises google.protobuf wrapper types as the bare scalar, which is
 * correct, but protobufjs's fromObject wants `{value: x}` for a message-typed
 * field and rejects the scalar outright. Without this every real file fails.
 *
 * Schema-guided rather than a list of known field names: across the sample
 * corpus this fires tens of thousands of times, so any hand-written list would
 * miss some. Walking resolvedType covers wrapper fields nobody has noticed.
 *
 * Returns undefined for null/undefined so the caller drops the key.
 */
function normaliseForProtobufjs(value: unknown, type: ProtoTypeLike | null): unknown {
  if (value === null || value === undefined) return undefined;
  if (!type?.fields) return value;

  if (Array.isArray(value)) {
    return value.map((v) => normaliseForProtobufjs(v, type));
  }

  if (typeof value !== 'object') {
    // A scalar where a message is expected is legal ONLY for wrapper types.
    // Anything else is left alone so verify() reports it, rather than this
    // function silently inventing a shape the schema never described.
    if (WRAPPER_TYPES.has(type.fullName.replace(/^\./, ''))) return { value };
    return value;
  }

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const field =
      type.fields[key] ?? Object.values(type.fields).find((f) => f.name === key);
    if (!field) {
      out[key] = v; // unknown field: leave it for verify() to flag
      continue;
    }
    const sub = field.resolvedType?.fields ? (field.resolvedType as ProtoTypeLike) : null;
    const nv = normaliseForProtobufjs(v, sub);
    if (nv !== undefined) out[key] = nv;
  }
  return out;
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

/**
 * Read, decode and validate one .fgmj file.
 *
 * @throws if the path is an AppleDouble file, is missing, is not JSON, is not
 *         an fgmj project, or does not satisfy the schema.
 */
export function loadFgmjProject(filePath: string): FgmjProject {
  const name = path.basename(filePath);

  // Rejected by name, before reading. macOS writes these beside the real files
  // and they are not JSON — a naive glob over a corpus directory finds twice
  // the files that actually exist.
  if (name.startsWith('._')) {
    throw new Error(
      `${filePath} is an AppleDouble (._) resource fork, not an .fgmj project. ` +
        'These sit beside real files on macOS and must not be treated as input.',
    );
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`.fgmj file not found: ${filePath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`${filePath} is not valid JSON — ${reason}`);
  }

  if (typeof parsed !== 'object' || parsed === null || !('project' in parsed)) {
    throw new Error(
      `${filePath} is not an fgmj project: no top-level "project" key. ` +
        'Expected a Prometheus/WISE job file.',
    );
  }

  const schema = loadFgmjSchema();
  const clean = normaliseForProtobufjs(parsed, schema.Message as unknown as ProtoTypeLike);

  const message = schema.Message.fromObject(clean as Record<string, unknown>);
  const invalid = schema.Message.verify(schema.Message.toObject(message));
  if (invalid) {
    throw new Error(`${filePath} does not satisfy the fgmj schema — ${invalid}`);
  }

  // `enums: String` because the file itself writes enum NAMES — "POLYGON_OUT",
  // "Minus" — and protobufjs would otherwise hand back the numbers. Names are
  // what the rest of this folder reads, and they survive the two same-named
  // Operation enums being numbered differently.
  const decoded = schema.Message.toObject(message, {
    defaults: false,
    enums: String,
  }) as Record<string, unknown>;
  const project = (decoded.project ?? {}) as Record<string, unknown>;

  const scenarioContainer = (project.scenarios ?? {}) as Record<string, unknown>;
  const scenarios = asArray(scenarioContainer.scenarios).map((entry) => {
    // The name sits on the scenario ENTRY. `entry.scenario` is the nested
    // settings message — startTime, endTime, fbpOptions — and carries no name.
    const scenarioName = entry.name;
    if (typeof scenarioName !== 'string' || scenarioName.length === 0) {
      throw new Error(
        `${filePath} contains a scenario with no name. ` +
          'Scenario names are how this file refers to its own scenarios.',
      );
    }
    return { name: scenarioName, raw: entry };
  });

  const ignitionContainer = (project.ignitions ?? {}) as Record<string, unknown>;
  const stationContainer = (project.stations ?? {}) as Record<string, unknown>;
  const gridContainer = (project.grids ?? {}) as Record<string, unknown>;

  return {
    scenarios,
    ignitions: asArray(ignitionContainer.ignitions),
    stations: asArray(stationContainer.stations),
    weatherFilters: asArray(gridContainer.filters),
    raw: project,
  };
}
