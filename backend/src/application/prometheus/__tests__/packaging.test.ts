/**
 * The importer must work in a BUILT IMAGE, not only in a dev checkout
 * (refs #294).
 *
 * Two things it needs that a dev checkout provides for free:
 *
 *   1. `protobufjs` — imported by fgmjSchema. It was a ROOT devDependency, so a
 *      production install of backend/package.json did not include it and the
 *      importer could not load at all.
 *   2. `vendor/wise-protos/fgmj_descriptor_set.pb` — read from disk at a path
 *      relative to the compiled output, and not copied into the image.
 *
 * Both failed loudly rather than silently, which is right, but "fails loudly in
 * production" is not shipped. These assertions are about packaging, so they
 * check the manifest and the Dockerfile — the things that were wrong — rather
 * than re-checking that the file loads, which other tests already cover.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DESCRIPTOR_PATH } from '../fgmjSchema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '..', '..', '..', '..');
const REPO = path.resolve(BACKEND, '..');

describe('#294 packaging', () => {
  it('declares protobufjs as a backend runtime dependency', () => {
    // Not a devDependency, and not only at the root: the production image
    // installs backend/package.json.
    const pkg = JSON.parse(fs.readFileSync(path.join(BACKEND, 'package.json'), 'utf8'));
    expect(pkg.dependencies?.protobufjs).toBeDefined();
    expect(pkg.devDependencies?.protobufjs).toBeUndefined();
  });

  it('resolves the descriptor set to a real file at the repo root', () => {
    expect(DESCRIPTOR_PATH).toBe(
      path.join(REPO, 'vendor', 'wise-protos', 'fgmj_descriptor_set.pb'),
    );
    expect(fs.existsSync(DESCRIPTOR_PATH)).toBe(true);
  });

  it('copies vendor/wise-protos into the production image', () => {
    // DESCRIPTOR_PATH is resolved four levels up from the compiled module, so
    // in the image (/app/backend/dist/application/prometheus) it lands at
    // /app/vendor/wise-protos. Nothing put it there.
    const dockerfile = fs.readFileSync(path.join(BACKEND, 'Dockerfile'), 'utf8');
    const production = dockerfile.slice(dockerfile.lastIndexOf('AS production'));
    expect(production).toMatch(/COPY\s+vendor\/wise-protos\s+\.\/vendor\/wise-protos/);
  });
});
