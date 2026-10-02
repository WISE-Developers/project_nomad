/**
 * The vendored WISE protobuf schema, loaded once (refs #294).
 *
 * The .fgmj is a protobuf JSON serialization — WISE's own validator names the
 * messages — so the descriptor set is the authority on its shape, enum
 * numbering included. Everything in this folder reads the format through here
 * rather than through a hand-written model that could drift from it.
 *
 * Loaded lazily and memoised: the descriptor set is 91 kB and both the weather
 * patch decoder and the project loader need it.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import protobuf from 'protobufjs';
import descriptor from 'protobufjs/ext/descriptor/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// src/application/prometheus and dist/application/prometheus sit at the same
// depth under backend/, so one path serves test and built runtime alike.
export const DESCRIPTOR_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'vendor',
  'wise-protos',
  'fgmj_descriptor_set.pb',
);

/** The root message of an .fgmj file. */
export const ROOT_MESSAGE = '.WISE.ProjectProto.PrometheusData';

export interface FgmjSchema {
  root: protobuf.Root;
  Message: protobuf.Type;
}

let cached: FgmjSchema | null = null;

/**
 * Load the descriptor set and resolve it.
 *
 * Throws if it is absent rather than degrading: without the schema nothing in
 * this folder can read an .fgmj correctly, and a loader that silently fell back
 * to untyped JSON would mis-read the two same-named Operation enums.
 */
export function loadFgmjSchema(): FgmjSchema {
  if (cached) return cached;

  if (!fs.existsSync(DESCRIPTOR_PATH)) {
    throw new Error(
      `fgmj descriptor set not found at ${DESCRIPTOR_PATH}. ` +
        'The Prometheus importer cannot read .fgmj files without it.',
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
  root.resolveAll();

  cached = { root, Message: root.lookupType(ROOT_MESSAGE) };
  return cached;
}
