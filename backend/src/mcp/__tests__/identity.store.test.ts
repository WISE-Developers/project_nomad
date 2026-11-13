/**
 * `createAuthUserStore()` against a REAL pair of databases (#531).
 *
 * WHY THIS FILE EXISTS, and it is the whole point. Nomad keeps accounts in a different
 * database from models:
 *
 *   /appl/data/nomad.db        models, jobs, fire_models  -- the `getKnex()` connection
 *   /appl/data/nomad_auth.db   auth_user, auth_session    -- opened by betterAuth.ts
 *
 * `createAuthUserStore()` queried `auth_user` on the MODELS connection. There is no such
 * table there and there never will be, so in `oauth` mode the identity check could not
 * succeed for any identity — and because `resolveMcpIdentity` throws when the store
 * cannot be consulted, and that throw is awaited in the startup path, enabling MCP on an
 * oauth instance crash-looped the entire application. Observed on the CIFFC demo at
 * v0.57.0: 10 restarts, site down until the configuration was reverted.
 *
 * EVERY EXISTING MCP IDENTITY TEST PASSES A FAKE STORE. That is reasonable for the
 * resolution logic — `mcpIdentity.test.ts` exercises found / not-found / cannot-consult
 * without a database, which is what makes those cases cheap to cover. But it means the
 * one line that chooses WHICH DATABASE to ask had no test at all, in a file otherwise
 * well covered. The bug lived in the gap between a tested interface and its untested
 * only implementation.
 *
 * So this suite deliberately uses real files on disk. A fake store here would reproduce
 * the original blind spot exactly.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PRESENT = 'present.person@example.com';
const ABSENT = 'absent.person@example.com';

let dataDir: string;
let savedDataPath: string | undefined;
let savedDatasetPath: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'nomad-mcp-identity-'));

  // The auth database: this is where accounts actually live.
  const auth = new Database(join(dataDir, 'nomad_auth.db'));
  auth.exec(`
    CREATE TABLE auth_user (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT,
      emailVerified INTEGER,
      image TEXT,
      createdAt TEXT,
      updatedAt TEXT
    );
  `);
  auth.prepare('INSERT INTO auth_user (id, name, email) VALUES (?, ?, ?)')
      .run('u1', 'Present Person', PRESENT);
  auth.close();

  // The models database, created alongside it and deliberately WITHOUT `auth_user`.
  // This is the file the broken implementation was asking, so its emptiness is the
  // control: if the store ever consults it, the lookup fails rather than quietly
  // returning the right answer by luck.
  const models = new Database(join(dataDir, 'nomad.db'));
  models.exec('CREATE TABLE fire_models (id TEXT PRIMARY KEY);');
  models.close();

  savedDataPath = process.env.NOMAD_DATA_PATH;
  savedDatasetPath = process.env.FIRESTARR_DATASET_PATH;
  process.env.NOMAD_DATA_PATH = dataDir;
  delete process.env.FIRESTARR_DATASET_PATH;
});

afterEach(() => {
  if (savedDataPath === undefined) delete process.env.NOMAD_DATA_PATH;
  else process.env.NOMAD_DATA_PATH = savedDataPath;
  if (savedDatasetPath === undefined) delete process.env.FIRESTARR_DATASET_PATH;
  else process.env.FIRESTARR_DATASET_PATH = savedDatasetPath;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('createAuthUserStore against real databases (#531)', () => {
  it('finds an address that exists in the AUTH database', async () => {
    const { createAuthUserStore } = await import('../identity.js');
    await expect(createAuthUserStore().hasAccount(PRESENT)).resolves.toBe(true);
  });

  /**
   * The negative half. Without it, a store that returned `true` unconditionally would
   * satisfy the assertion above — and "every address is valid" is a worse failure than
   * the one being fixed, because MCP would then attribute records to accounts that do
   * not exist, which is precisely what resolveMcpIdentity exists to prevent.
   */
  it('does NOT find an address that is absent from it', async () => {
    const { createAuthUserStore } = await import('../identity.js');
    await expect(createAuthUserStore().hasAccount(ABSENT)).resolves.toBe(false);
  });

  /**
   * The interface contract: "could not ask" must THROW, never return false. The caller
   * reports the two differently on purpose, because "this name is wrong" and "I could
   * not find out" call for different fixes from whoever reads the startup error.
   */
  it('THROWS rather than returning false when the auth database is absent', async () => {
    rmSync(join(dataDir, 'nomad_auth.db'), { force: true });
    const { createAuthUserStore } = await import('../identity.js');
    await expect(createAuthUserStore().hasAccount(PRESENT)).rejects.toThrow();
  });

  /**
   * The regression itself, stated as its own assertion so a future refactor that
   * reintroduces the models connection fails HERE, with this explanation, rather than
   * somewhere less obvious. `auth_user` is absent from nomad.db by construction above,
   * so a store consulting it cannot answer `true` for an address that genuinely exists.
   */
  it('asks the auth database, not the models database', async () => {
    const models = new Database(join(dataDir, 'nomad.db'), { readonly: true });
    const hasAuthUser = models.prepare(
      "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='auth_user'",
    ).get() as { n: number };
    models.close();

    // Control on the fixture: the models database really does lack the table, so the
    // assertion below is testing what it claims to test.
    expect(hasAuthUser.n).toBe(0);

    const { createAuthUserStore } = await import('../identity.js');
    await expect(createAuthUserStore().hasAccount(PRESENT)).resolves.toBe(true);
  });
});
