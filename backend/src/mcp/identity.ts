/**
 * MCP identity — who owns what MCP creates.
 *
 * The key in `auth.ts` decides whether a caller may act. This decides what the record
 * says afterwards. They are separate concerns: the key is about authorisation, the
 * identity is about attribution, and getting the second one right is what makes MCP
 * output usable by the rest of the system.
 *
 * THE IDENTITY MUST RESOLVE TO A REAL ACCOUNT. Everything MCP creates is stored against
 * it, in the same terms the HTTP path uses, so that MCP-created records are owned and
 * attributable like any other. A configured identity that matches no account would
 * produce records attributed to something that does not exist, so this fails at startup
 * instead.
 *
 * WHAT "RESOLVED" MEANS, PER MODE. Only `oauth` has a local account store to check
 * against — `auth_user`, which Better Auth manages and creates itself, so it is not
 * present in the other modes. `simple` takes a display name from a header, `none` has
 * no identity concept, and ACN defers to an upstream agency this process cannot
 * interrogate at startup.
 *
 * So in three of the four modes there is nothing to resolve against, and that is
 * RECORDED rather than glossed: `verified: false` labels a claim this process cannot
 * test, and the startup log says so. Treating "no store to ask" as "the answer was yes"
 * would leave the configuration looking checked when nothing had checked it.
 */
// No database import at module scope on purpose. The account store resolves the auth
// database lazily inside `hasAccount` (#531), so this module pulls in neither the models
// connection nor better-sqlite3 unless an oauth instance actually asks the question.

/** The auth modes this process can run in. ACN is a deployment mode, not a SAN auth mode. */
export type McpAuthMode = 'oauth' | 'simple' | 'none' | 'acn';

/**
 * The account store, narrowed to the single question MCP needs answered.
 *
 * An interface rather than a direct query so that the resolution logic can be tested
 * against both answers and against an unavailable store, without a database.
 */
export interface McpIdentityStore {
  /**
   * @throws if the store cannot be consulted. Must NOT return false for "don't know" —
   *         "no such account" and "could not ask" are different answers and the caller
   *         distinguishes them.
   */
  hasAccount(email: string): Promise<boolean>;
}

export interface ResolvedMcpIdentity {
  /** Stored on everything MCP creates, matching what `resolveUserId` writes for HTTP. */
  readonly userId: string;
  /**
   * Whether the identity was checked against a real account store.
   *
   * `false` means this mode has no store, so the claim is untested and labelled as
   * such. It is never `false` because a check failed — a failed check throws.
   */
  readonly verified: boolean;
}

/**
 * The real account store, backed by Better Auth's user table.
 *
 * Better Auth owns this schema (`modelName: 'auth_user'`) and creates it itself, so the
 * table exists only where Better Auth runs — that is, in oauth mode. A missing table
 * therefore throws, and the caller reads a throw as "unverifiable", never as "no such
 * account".
 */
export function createAuthUserStore(): McpIdentityStore {
  return {
    async hasAccount(email: string): Promise<boolean> {
      // ACCOUNTS ARE NOT IN THE MODELS DATABASE (#531). This used to call `getKnex()`,
      // which is the connection to `nomad.db` — models, jobs, fire_models. `auth_user`
      // lives in `nomad_auth.db`, a separate file Better Auth opens for itself. The
      // query therefore failed with `no such table: auth_user` for EVERY identity, and
      // because `resolveMcpIdentity` turns an unanswerable check into a throw inside the
      // startup path, enabling MCP on an oauth instance crash-looped the whole
      // application rather than merely disabling MCP.
      //
      // The path comes from `resolveAuthDbPath()` rather than being rebuilt here, so
      // there is exactly one answer to "where are the accounts".
      //
      // Opened READ-ONLY and closed immediately: this is a startup-time question asked
      // once, and MCP has no business holding a writable handle on the auth database.
      const { resolveAuthDbPath } = await import('../infrastructure/auth/betterAuth.js');
      const { default: Database } = await import('better-sqlite3');

      // A missing or unreadable file throws here, which is the contract: the caller
      // must be able to tell "could not ask" from "no such account".
      const db = new Database(resolveAuthDbPath(), { readonly: true, fileMustExist: true });
      try {
        const row = db.prepare('SELECT 1 FROM auth_user WHERE email = ? LIMIT 1').get(email);
        return Boolean(row);
      } finally {
        db.close();
      }
    },
  };
}

/**
 * The identity named an account that does not exist (#543).
 *
 * This is the ATTRIBUTION failure, and it is fatal: records MCP created would be
 * written as a user who is not there. Stopping the process is the right answer and
 * stays the right answer.
 */
export class McpIdentityUnmatchedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpIdentityUnmatchedError';
  }
}

/**
 * The identity could not be ASKED about (#543) — no store, a wrong database, a locked
 * file, a bug in the store.
 *
 * Nothing is attributed wrongly because nothing was written: MCP simply does not
 * mount. It is deliberately NOT a subclass of the unmatched error, and neither is a
 * subclass of the other, because the call site branches on `instanceof` and an
 * inheritance relationship would silently collapse the distinction this exists to
 * draw.
 */
export class McpIdentityUnverifiableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpIdentityUnverifiableError';
  }
}

/**
 * Resolves the configured MCP identity, failing closed when it cannot be proven.
 *
 * @throws {McpIdentityUnmatchedError} in oauth mode when the account does not exist.
 * @throws {McpIdentityUnverifiableError} when the store cannot be consulted at all.
 *
 * An unanswered check is not a pass. The two outcomes were always reported with
 * different MESSAGES on purpose — because "this name is wrong" and "I could not find
 * out" call for different fixes from whoever is reading the error — but they were both
 * a plain `Error`, so no caller could act on the difference. Prose is not a type;
 * #543 gave them one each.
 */
export async function resolveMcpIdentity(
  identity: string,
  authMode: McpAuthMode,
  store?: McpIdentityStore,
): Promise<ResolvedMcpIdentity> {
  if (authMode !== 'oauth') {
    // No local account store exists in these modes. Do not consult one even if a caller
    // passed it: a verification against a store the running mode does not use would
    // describe something other than the identity actually in effect.
    return { userId: identity, verified: false };
  }

  if (!store) {
    // Nothing was asked, so nothing was disproved: unverifiable, not unmatched.
    throw new McpIdentityUnverifiableError(
      `NOMAD_MCP_IDENTITY ("${identity}") could not be verified: no account store was ` +
        'available in oauth mode. MCP will not start with an identity it cannot resolve.',
    );
  }

  let exists: boolean;
  try {
    exists = await store.hasAccount(identity);
  } catch (error) {
    throw new McpIdentityUnverifiableError(
      `NOMAD_MCP_IDENTITY ("${identity}") could not be verified: the account store ` +
        `could not be consulted (${error instanceof Error ? error.message : String(error)}). ` +
        'Not starting, rather than attributing models to an unchecked identity.',
    );
  }

  if (!exists) {
    throw new McpIdentityUnmatchedError(
      `NOMAD_MCP_IDENTITY ("${identity}") does not match any account in this instance, ` +
        'so records MCP created would be attributed to an account that does not exist. ' +
        'Sign in once with this address, or set NOMAD_MCP_IDENTITY to an address that ' +
        'already has an account.',
    );
  }

  return { userId: identity, verified: true };
}

/**
 * Resolve the identity, or report that MCP must stay unmounted (#543).
 *
 * THE POLICY, and why it is not symmetric:
 *
 *   unmatched    -> RETHROW. The process stops, as it always did. An identity naming
 *                   no account would attribute records to a user who is not there,
 *                   and that is worth refusing to boot over.
 *   unverifiable -> return null after logging loudly. MCP does not mount and the rest
 *                   of the application starts. Nothing is attributed wrongly because
 *                   nothing is written, and an optional feature behind a flag must not
 *                   be able to take the fire-modelling site down. #531 was this case:
 *                   the query hit the wrong database, so the check could not be
 *                   performed at all, and the demo crash-looped for ~4 minutes with 10
 *                   restarts under `restart: unless-stopped`.
 *
 * This makes the file's existing asymmetry deliberate rather than accidental: with the
 * flag set and no auth key, MCP already does not start and the app comes up fine. A
 * missing key was tolerated while an unanswerable check was fatal, and both are
 * equally "MCP is not usable".
 *
 * ANYTHING ELSE RETHROWS. A failure that is neither known kind is not downgraded to a
 * quiet unmount — catching broadly here would turn every future bug in this path into
 * a silently absent MCP, which is the silent default this codebase refuses.
 *
 * @param log  called ONLY on the unverifiable path, with a message naming the cause.
 * @param resolve injected so the "unexpected error" branch is reachable in tests;
 *                `resolveMcpIdentity` wraps everything a store throws into one of the
 *                two classes, so a third kind cannot be produced through it.
 */
export async function resolveMcpIdentityOrUnmount(
  identity: string,
  authMode: McpAuthMode,
  store: McpIdentityStore | undefined,
  log: (message: string) => void,
  resolve: typeof resolveMcpIdentity = resolveMcpIdentity,
): Promise<ResolvedMcpIdentity | null> {
  try {
    return await resolve(identity, authMode, store);
  } catch (error) {
    if (error instanceof McpIdentityUnverifiableError) {
      // Loud, and carrying the underlying cause: a bare "MCP disabled" would leave
      // the reader with no idea which of the two failures happened or how to fix it.
      log(
        `MCP will NOT start: the configured identity could not be verified. The rest of ` +
          `the application is starting normally. Cause: ${error.message}`,
      );
      return null;
    }
    throw error;
  }
}
