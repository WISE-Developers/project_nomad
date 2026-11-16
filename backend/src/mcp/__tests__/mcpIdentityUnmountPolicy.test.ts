/**
 * #543 — an MCP identity failure must not take the whole site down.
 *
 * THE DECISION (Franco, 2026-11-16): "distinguish them." Two failures were being
 * treated as one:
 *
 *   identity resolves to NO ACCOUNT   -> attribution risk. Records would be
 *                                        written as a user that does not exist.
 *                                        Stopping the process is right.
 *   identity CANNOT BE ASKED          -> wrong database, locked file, a bug in the
 *                                        store. Threatens nothing. The fire-modelling
 *                                        site went down for an optional feature behind
 *                                        a flag that was not serving traffic yet.
 *
 * #531 was the second kind: the query hit the wrong database, so the check could not
 * be performed at all, and the demo crash-looped for ~4 minutes with 10 restarts
 * under `restart: unless-stopped`.
 *
 * `resolveMcpIdentity` already wrote DIFFERENT MESSAGES for the two, and its doc
 * comment says they are "reported differently on purpose" — but both were a plain
 * `Error`, so no caller could act on the difference. Prose is not a type.
 *
 * The asymmetry this removes was already visible in index.ts two lines apart: with
 * the flag set and NO AUTH KEY, MCP does not start and the app comes up fine; with
 * an unanswerable identity check, the process died. Both are "MCP is not usable".
 */

import { describe, it, expect, vi } from 'vitest';
import {
  resolveMcpIdentity,
  resolveMcpIdentityOrUnmount,
  McpIdentityUnmatchedError,
  McpIdentityUnverifiableError,
  type McpIdentityStore,
} from '../identity.js';

const IDENTITY = 'sage@example.org';

function storeThatAnswers(exists: boolean): McpIdentityStore {
  return { hasAccount: vi.fn(async () => exists) };
}

function storeThatCannotAnswer(message = 'no such table: user'): McpIdentityStore {
  return {
    hasAccount: vi.fn(async () => {
      throw new Error(message);
    }),
  };
}

describe('#543 — the two identity failures are different TYPES, not just different messages', () => {
  it('an identity matching no account throws McpIdentityUnmatchedError', async () => {
    await expect(
      resolveMcpIdentity(IDENTITY, 'oauth', storeThatAnswers(false)),
    ).rejects.toBeInstanceOf(McpIdentityUnmatchedError);
  });

  it('a store that cannot be consulted throws McpIdentityUnverifiableError', async () => {
    await expect(
      resolveMcpIdentity(IDENTITY, 'oauth', storeThatCannotAnswer()),
    ).rejects.toBeInstanceOf(McpIdentityUnverifiableError);
  });

  it('oauth mode with no store at all is unverifiable, not unmatched', async () => {
    // Nothing was asked, so nothing was disproved. This is the same category as a
    // missing auth key, which already lets the app boot without MCP.
    await expect(
      resolveMcpIdentity(IDENTITY, 'oauth', undefined),
    ).rejects.toBeInstanceOf(McpIdentityUnverifiableError);
  });

  it('THE DISCRIMINATOR: the two classes are not instances of each other', async () => {
    // If one extended the other, a `catch (e) { if (e instanceof X) ... }` would
    // silently misclassify one of them and the whole fix would be inert — green
    // tests over a distinction that collapses at the call site.
    const unmatched = await resolveMcpIdentity(IDENTITY, 'oauth', storeThatAnswers(false)).catch((e) => e);
    const unverifiable = await resolveMcpIdentity(IDENTITY, 'oauth', storeThatCannotAnswer()).catch((e) => e);

    expect(unmatched).not.toBeInstanceOf(McpIdentityUnverifiableError);
    expect(unverifiable).not.toBeInstanceOf(McpIdentityUnmatchedError);
  });

  it('keeps the existing messages, which name the fix for whoever is reading', async () => {
    await expect(
      resolveMcpIdentity(IDENTITY, 'oauth', storeThatAnswers(false)),
    ).rejects.toThrow(/does not match any account/);

    await expect(
      resolveMcpIdentity(IDENTITY, 'oauth', storeThatCannotAnswer('no such table: user')),
    ).rejects.toThrow(/could not be consulted.*no such table: user/s);
  });

  it('still returns an unverified identity in non-oauth modes, unchanged', async () => {
    const resolved = await resolveMcpIdentity(IDENTITY, 'none', undefined);
    expect(resolved).toEqual({ userId: IDENTITY, verified: false });
  });
});

describe('#543 — resolveMcpIdentityOrUnmount applies the policy', () => {
  it('returns the identity when it verifies', async () => {
    const log = vi.fn();
    const resolved = await resolveMcpIdentityOrUnmount(IDENTITY, 'oauth', storeThatAnswers(true), log);

    expect(resolved).toEqual({ userId: IDENTITY, verified: true });
    expect(log).not.toHaveBeenCalled();
  });

  it('returns null and logs LOUDLY when the store cannot answer — the app must boot', async () => {
    const log = vi.fn();

    const resolved = await resolveMcpIdentityOrUnmount(
      IDENTITY,
      'oauth',
      storeThatCannotAnswer('attempt to write a readonly database'),
      log,
    );

    expect(resolved).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);

    const message = log.mock.calls[0][0] as string;
    // Loud enough to find in startup logs, and it must carry the underlying cause —
    // a quiet "MCP disabled" would be the silent default this codebase refuses.
    expect(message).toMatch(/MCP will NOT start/);
    expect(message).toMatch(/attempt to write a readonly database/);
  });

  it('RETHROWS when the identity matches no account — attribution still fails closed', async () => {
    const log = vi.fn();

    await expect(
      resolveMcpIdentityOrUnmount(IDENTITY, 'oauth', storeThatAnswers(false), log),
    ).rejects.toBeInstanceOf(McpIdentityUnmatchedError);
  });

  it('does not swallow an unexpected error type either', async () => {
    // A failure that is neither of the two known kinds must NOT be downgraded to
    // "boot without MCP". An unrecognised failure is a mistake someone made, and the
    // only safe reading of a mistake is still to stop. Catching broadly here would
    // turn every future bug in this path into a silently unmounted MCP.
    //
    // The resolver is injected because `resolveMcpIdentity` wraps everything a store
    // throws into one of the two classes, so a third kind cannot be produced through
    // it. Injection is how this branch is reachable at all.
    const log = vi.fn();
    const resolverThrowingSomethingElse = async () => {
      throw new RangeError('something nobody anticipated');
    };

    await expect(
      resolveMcpIdentityOrUnmount(
        IDENTITY,
        'oauth',
        storeThatAnswers(true),
        log,
        resolverThrowingSomethingElse,
      ),
    ).rejects.toBeInstanceOf(RangeError);
    expect(log).not.toHaveBeenCalled();
  });
});
