/**
 * Weather-patch operation decoding for Prometheus/WISE .fgmj import (refs #294).
 *
 * The fgmj schema declares two enums called `Operation` under
 * `WeatherProto.WeatherGridFilter`, and they are numbered differently:
 *
 *   GridTypeOne  Equal 0  Plus 1  Minus 2  Multiply 3  Divide 4  Disable 5
 *   GridTypeTwo  Equal 0  Plus 1  Minus 2                        Disable 3
 *
 * GridTypeOne covers temperature, rh, precipitation and windSpeed.
 * GridTypeTwo covers windDirection, and nothing else.
 *
 * A raw `3` is therefore Multiply on a temperature patch and Disable on a wind
 * direction patch. Decoding one with the other's table does not fail: the run
 * completes and the output looks plausible. That is why the numbering is read
 * out of the vendored descriptor set here rather than hand-copied into a
 * constant that could drift from the schema it claims to mirror.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import protobuf from 'protobufjs';
import descriptor from 'protobufjs/ext/descriptor/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// src/application/prometheus and dist/application/prometheus sit at the same
// depth under backend/, so one path serves test and built runtime alike.
const DESCRIPTOR_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'vendor',
  'wise-protos',
  'fgmj_descriptor_set.pb',
);

/** Which of the two same-named `Operation` enums applies to a field. */
export enum GridType {
  /** temperature, rh, precipitation, windSpeed */
  One = 'GridTypeOne',
  /** windDirection */
  Two = 'GridTypeTwo',
}

type OperationTable = Readonly<Record<number, string>>;

function loadOperationTables(): Record<GridType, OperationTable> {
  if (!fs.existsSync(DESCRIPTOR_PATH)) {
    throw new Error(
      `fgmj descriptor set not found at ${DESCRIPTOR_PATH}. ` +
        'The Prometheus importer cannot decode weather patches without it.',
    );
  }

  // `fromDescriptor` is added to Root by requiring the descriptor extension,
  // and protobufjs declares no types for it. Narrow cast rather than a module
  // augmentation: see the note in types/protobufjs-descriptor.d.ts about an
  // ambient `declare module 'protobufjs'` erasing the real Root.
  const RootWithDescriptor = protobuf.Root as unknown as {
    fromDescriptor(descriptorSet: object): protobuf.Root;
  };

  const root = RootWithDescriptor.fromDescriptor(
    descriptor.FileDescriptorSet.decode(fs.readFileSync(DESCRIPTOR_PATH)),
  );

  const tables = {} as Record<GridType, OperationTable>;
  for (const gridType of [GridType.One, GridType.Two]) {
    const fullName = `WISE.WeatherProto.WeatherGridFilter.${gridType}.Operation`;
    const node = root.lookupEnum(fullName);
    if (!node) {
      throw new Error(`fgmj descriptor set declares no enum ${fullName}.`);
    }
    // node.values is name -> number; we want the inverse, because the wire form
    // carries the number and the JSON form carries the name.
    const byNumber: Record<number, string> = {};
    for (const [name, value] of Object.entries(node.values) as [string, number][]) {
      byNumber[value] = name;
    }
    tables[gridType] = Object.freeze(byNumber);
  }
  return tables;
}

const OPERATIONS = loadOperationTables();

/**
 * Resolve a weather-patch operation to its schema name.
 *
 * Accepts the numeric form and the string form — Prometheus writes the name in
 * the JSON serialization, while the wire form carries the number.
 *
 * Throws on anything it cannot resolve for the given grid type, including a
 * value that is valid for the *other* enum. There is no default: an operation
 * we cannot name is an operation we cannot apply, and a silently skipped patch
 * produces a run that looks right and burns differently.
 */
export function decodeOperation(raw: number | string, gridType: GridType): string {
  const table = OPERATIONS[gridType];

  if (raw === null || raw === undefined) {
    throw new Error(
      `Weather patch has no operation for ${gridType}. ` +
        `Expected one of: ${Object.values(table).join(', ')}.`,
    );
  }

  if (typeof raw === 'number') {
    const name = table[raw];
    if (name === undefined) {
      throw new Error(
        `Unknown weather patch operation ${raw} for ${gridType}. ` +
          `Valid values: ${Object.entries(table)
            .map(([n, v]) => `${v}=${n}`)
            .join(', ')}.`,
      );
    }
    return name;
  }

  if (Object.values(table).includes(raw)) {
    return raw;
  }

  throw new Error(
    `Unknown weather patch operation "${raw}" for ${gridType}. ` +
      `Valid names: ${Object.values(table).join(', ')}.`,
  );
}
