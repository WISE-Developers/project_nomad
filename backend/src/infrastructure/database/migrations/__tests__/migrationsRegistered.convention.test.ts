/**
 * Convention test — every migration file must be REGISTERED.
 *
 * `runner.ts` discovers migrations from a hand-kept list: each one is imported
 * explicitly and added to a `migrations` array. Nothing reads the directory.
 *
 * So a migration file that exists and is not in that list **never runs**, and
 * nothing anywhere reports it. The file is on disk, it is committed, it is in
 * the diff, it passes review — and the column it creates does not exist. The
 * failure surfaces later as a query against a missing table, in whichever
 * environment someone deployed to first.
 *
 * This is the hand-kept-list drift that keeps showing up in this codebase:
 * the ignition enum that forgot `linestring`, the MCP options literal that
 * omitted half its fields, the deploy docs naming a command nobody installed.
 * A list a human maintains drifts for exactly the reason the Coordination note
 * drifted — somebody has to remember.
 *
 * So this test READS THE DIRECTORY and asserts the runner knows about every
 * file in it. It is the same shape as
 * `src/application/execution/__tests__/executionParity.convention.test.ts` and
 * `src/shared/__tests__/noBareNewDate.convention.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, '..');
const RUNNER = join(MIGRATIONS_DIR, 'runner.ts');

/** Migration files on disk, by their numeric prefix name. */
function migrationFilesOnDisk(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((entry) => /^\d{3}_.+\.ts$/.test(entry))
    .map((entry) => entry.replace(/\.ts$/, ''))
    .sort();
}

const runnerSource = readFileSync(RUNNER, 'utf8');

describe('every migration file is registered in the runner', () => {
  describe('the controls', () => {
    it('actually finds migration files — an empty read would pass everything', () => {
      const files = migrationFilesOnDisk();
      expect(files.length).toBeGreaterThan(0);
      expect(files).toContain('001_create_tables');
    });

    it('actually reads the runner', () => {
      expect(runnerSource).toContain('const migrations');
      expect(runnerSource.length).toBeGreaterThan(100);
    });

    it('goes RED for a migration the runner does not know about', () => {
      // The known positive. A guard that has never been seen to fail is an
      // unknown guard — and this one is cheap to demonstrate, because the
      // failure mode is exactly "a name is absent from a string".
      const invented = '099_a_migration_nobody_registered';
      expect(runnerSource).not.toContain(invented);
    });
  });

  it('registers every migration file that exists on disk', () => {
    const files = migrationFilesOnDisk();

    const unregistered = files.filter((name) => {
      // Registered means BOTH imported and listed. An import alone compiles and
      // does nothing; a list entry alone does not compile. Requiring both means
      // a half-done registration fails here rather than at runtime.
      const imported = runnerSource.includes(`./${name}.js`);
      const listed = runnerSource.includes(`'${name}'`);
      return !(imported && listed);
    });

    expect(
      unregistered,
      `These migration files exist but the runner will never execute them: ` +
        `${unregistered.join(', ')}.\n` +
        `Add an import and a \`migrations\` entry in runner.ts for each. A ` +
        `migration that is not registered does not fail — it silently does not run.`,
    ).toEqual([]);
  });

  it('does not register a migration that no longer exists on disk', () => {
    // The other direction. A stale entry for a deleted file is an import that
    // will not resolve — caught by tsc — but a stale *name* in the list with no
    // import would silently be a no-op. Both directions asserted, so a guard
    // that only ever checks one cannot pass by being half a check.
    const files = new Set(migrationFilesOnDisk());
    const listed = Array.from(runnerSource.matchAll(/name:\s*'(\d{3}_[a-z0-9_]+)'/g)).map(
      (m) => m[1],
    );

    expect(listed.length).toBeGreaterThan(0);
    const orphans = listed.filter((name) => !files.has(name));
    expect(orphans, `Registered but missing from disk: ${orphans.join(', ')}`).toEqual([]);
  });
});
