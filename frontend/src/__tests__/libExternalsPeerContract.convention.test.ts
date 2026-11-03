/**
 * Convention test — the library build's `external` list and the manifest must
 * describe the same contract (#485).
 *
 * Background: `vite.lib.config.ts` externalised seven entries under the comment
 * "Externalize peer dependencies - consumers must provide these", while only
 * `react` and `react-dom` were declared in `peerDependencies`. The other four
 * sat in `dependencies`.
 *
 * An externalised module is NOT in the bundle, so the consumer's resolver has
 * to find it. `dependencies` is the wrong field for that: resolution then rests
 * on hoisting rather than on a declared peer relationship, and `maplibre-gl`
 * carries module-level state, so a consumer on a different major can end up
 * with two copies loaded — the failure `peerDependencies` exists to prevent.
 *
 * This guard pins the invariant rather than the current answer: every entry in
 * `external` is a declared peer, or it is not externalised. Adding a new
 * external without declaring it reddens here.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const frontendRoot = join(__dirname, '..', '..');

/** The `external` array as the library build actually declares it. */
function externalisedPackages(): string[] {
  const source = readFileSync(join(frontendRoot, 'vite.lib.config.ts'), 'utf-8');

  const block = source.match(/external:\s*\[([\s\S]*?)\]/);
  if (!block) throw new Error('No `external: [...]` found in vite.lib.config.ts');

  const entries = Array.from(block[1].matchAll(/'([^']+)'/g)).map(m => m[1]);
  if (entries.length === 0) throw new Error('`external` parsed as empty — selector is wrong');

  // `react/jsx-runtime` is a subpath of `react`; the peer declaration that
  // covers the package covers its subpaths too.
  return Array.from(new Set(entries.map(e => (e.startsWith('react/') ? 'react' : e))));
}

function manifest(): {
  peerDependencies: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { optional?: boolean }>;
} {
  const pkg = JSON.parse(
    readFileSync(join(frontendRoot, 'package.json'), 'utf-8')
  ) as Record<string, Record<string, never>>;
  return {
    peerDependencies: (pkg.peerDependencies ?? {}) as Record<string, string>,
    dependencies: (pkg.dependencies ?? {}) as Record<string, string>,
    devDependencies: (pkg.devDependencies ?? {}) as Record<string, string>,
    peerDependenciesMeta: (pkg.peerDependenciesMeta ?? {}) as Record<
      string,
      { optional?: boolean }
    >,
  };
}

describe('convention: externalised packages are declared peers (#485)', () => {
  it('parses a non-empty external list and a manifest (control for the two readers)', () => {
    // Without this, a selector that silently matched nothing would make every
    // assertion below vacuously true — the shape that once let a test pass
    // before its feature existed.
    const external = externalisedPackages();
    expect(external.length).toBeGreaterThan(0);
    expect(external).toContain('react');

    const pkg = manifest();
    expect(Object.keys(pkg.peerDependencies).length).toBeGreaterThan(0);
  });

  it('declares every externalised package in peerDependencies', () => {
    const external = externalisedPackages();
    const { peerDependencies } = manifest();

    const undeclared = external.filter(name => !(name in peerDependencies));
    expect(undeclared).toEqual([]);
  });

  it('does not externalise a package it only lists in dependencies', () => {
    const external = externalisedPackages();
    const { dependencies } = manifest();

    // The specific defect #485 recorded: externalised, but the version is
    // pinned by us rather than negotiated with the consumer.
    const externalisedRuntimeDeps = external.filter(name => name in dependencies);
    expect(externalisedRuntimeDeps).toEqual([]);
  });

  it('keeps @turf/turf bundled rather than peered', () => {
    const external = externalisedPackages();
    const { dependencies } = manifest();

    // Decided per package: @turf/turf is stateless functions, so a duplicate
    // copy costs bytes and nothing else. Bundling removes the contract instead
    // of documenting it.
    expect(external).not.toContain('@turf/turf');
    expect(dependencies).toHaveProperty('@turf/turf');
  });

  it('carries no UMD globals entry for a package that is not externalised', () => {
    const source = readFileSync(join(frontendRoot, 'vite.lib.config.ts'), 'utf-8');
    const block = source.match(/globals:\s*\{([\s\S]*?)\}/);
    expect(block).not.toBeNull();

    const named = Array.from(block![1].matchAll(/'?([@\w/.-]+)'?\s*:/g)).map(m => m[1]);
    expect(named.length).toBeGreaterThan(0); // control: the selector found entries

    const external = externalisedPackages();
    // A globals entry for a bundled module is dead config that reads as a
    // contract. Rollup ignores it, which is exactly why it rots unnoticed.
    const orphans = named.filter(
      name => !external.includes(name.startsWith('react/') ? 'react' : name)
    );
    expect(orphans).toEqual([]);
  });

  it('does NOT mark a statically-required package as an optional peer', () => {
    const { peerDependencies, peerDependenciesMeta, devDependencies } = manifest();

    for (const name of ['maplibre-gl', 'terra-draw', 'terra-draw-maplibre-gl-adapter']) {
      expect(peerDependencies).toHaveProperty(name);

      // These were briefly `optional: true`, on the premise that a consumer
      // embedding only the Dashboard never needs a map stack. MEASURED FALSE:
      // the built library requires all three unconditionally -- the UMD bundle
      // carries `require("maplibre-gl")`, `require("terra-draw")` and
      // `require("terra-draw-maplibre-gl-adapter")` at the top level, and the
      // ES entry statically imports the one chunk that holds them. There is no
      // dynamic import anywhere, so no surface avoids them.
      //
      // And the two install behaviours differ, measured from a tarball, which
      // is how our one known consumer actually installs this package:
      //   required peer -> npm installs it
      //   optional peer -> npm does NOT
      // So `optional` on a static import guarantees an unresolved module for
      // anyone who simply runs `npm install`, and no gate catches it: the
      // install succeeds, nothing typechecks a vendored dist, and the suite
      // passes. It fails at runtime, in a deploy.
      expect(peerDependenciesMeta[name]?.optional).toBeUndefined();

      // Still a devDependency, or this repo cannot build or test the code that
      // imports them.
      expect(devDependencies).toHaveProperty(name);
    }
  });
});
