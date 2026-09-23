/**
 * Better Auth Configuration
 *
 * Configures Better Auth for OAuth social login in SAN mode.
 * Only initialized when NOMAD_AUTH_MODE=oauth.
 * Supports Google, Microsoft, GitHub, Apple, Discord, Facebook, and Twitter providers.
 */

import { betterAuth, type BetterAuthOptions } from 'better-auth';
import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { resolve } from 'path';
import { logger } from '../logging/index.js';
import { sessionUsageTracker } from '../../api/middleware/betterAuthSession.js';
import { createUsageEvent, UNKNOWN_USER } from '../../application/usage/usageEvent.js';
import { getUsageLogger } from '../usage/index.js';
import { EnvironmentService } from '../config/EnvironmentService.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let authInstance: any = null;

/**
 * Emits session.logout when Better Auth deletes a session.
 *
 * Never throws: signing out must not fail because the usage log could not be
 * written.
 */
async function recordLogout(session: { id?: string; token?: string }): Promise<void> {
  try {
    const sessionId = session?.id ?? session?.token;
    if (!sessionId) return;

    // Null when the session predates this process - after a restart our memory
    // of it is gone. Recorded as unknown rather than guessing at a name.
    const email = sessionUsageTracker.noteEnded(sessionId);

    await getUsageLogger().record(
      createUsageEvent({
        type: 'session.logout',
        actor: email ?? UNKNOWN_USER,
        zone: EnvironmentService.getInstance().getHomeTimezone(),
        now: new Date(),
        detail: {
          explicit: true,
          actor_resolved: email !== null,
        },
      })
    );
  } catch {
    // Usage logging must never break sign-out.
  }
}

/**
 * Build Better Auth social provider config from environment variables.
 * Only includes providers that have both client ID and secret configured.
 */
function buildSocialProviders(): BetterAuthOptions['socialProviders'] {
  const providers: BetterAuthOptions['socialProviders'] = {};

  // Each provider uses prompt: 'select_account' so that after sign-out,
  // a different user can choose their own account instead of auto-re-authenticating.

  if (process.env.NOMAD_OAUTH_GOOGLE_CLIENT_ID && process.env.NOMAD_OAUTH_GOOGLE_CLIENT_SECRET) {
    providers.google = {
      clientId: process.env.NOMAD_OAUTH_GOOGLE_CLIENT_ID,
      clientSecret: process.env.NOMAD_OAUTH_GOOGLE_CLIENT_SECRET,
      prompt: 'select_account',
    };
    logger.startup('  OAuth provider: Google');
  }

  if (process.env.NOMAD_OAUTH_MICROSOFT_CLIENT_ID && process.env.NOMAD_OAUTH_MICROSOFT_CLIENT_SECRET) {
    providers.microsoft = {
      clientId: process.env.NOMAD_OAUTH_MICROSOFT_CLIENT_ID,
      clientSecret: process.env.NOMAD_OAUTH_MICROSOFT_CLIENT_SECRET,
      prompt: 'select_account',
    };
    logger.startup('  OAuth provider: Microsoft');
  }

  if (process.env.NOMAD_OAUTH_GITHUB_CLIENT_ID && process.env.NOMAD_OAUTH_GITHUB_CLIENT_SECRET) {
    providers.github = {
      clientId: process.env.NOMAD_OAUTH_GITHUB_CLIENT_ID,
      clientSecret: process.env.NOMAD_OAUTH_GITHUB_CLIENT_SECRET,
      prompt: 'select_account',
    };
    logger.startup('  OAuth provider: GitHub');
  }

  if (process.env.NOMAD_OAUTH_APPLE_CLIENT_ID && process.env.NOMAD_OAUTH_APPLE_CLIENT_SECRET) {
    providers.apple = {
      clientId: process.env.NOMAD_OAUTH_APPLE_CLIENT_ID,
      clientSecret: process.env.NOMAD_OAUTH_APPLE_CLIENT_SECRET,
    };
    logger.startup('  OAuth provider: Apple');
  }

  if (process.env.NOMAD_OAUTH_DISCORD_CLIENT_ID && process.env.NOMAD_OAUTH_DISCORD_CLIENT_SECRET) {
    providers.discord = {
      clientId: process.env.NOMAD_OAUTH_DISCORD_CLIENT_ID,
      clientSecret: process.env.NOMAD_OAUTH_DISCORD_CLIENT_SECRET,
      prompt: 'consent',
    };
    logger.startup('  OAuth provider: Discord');
  }

  if (process.env.NOMAD_OAUTH_FACEBOOK_CLIENT_ID && process.env.NOMAD_OAUTH_FACEBOOK_CLIENT_SECRET) {
    providers.facebook = {
      clientId: process.env.NOMAD_OAUTH_FACEBOOK_CLIENT_ID,
      clientSecret: process.env.NOMAD_OAUTH_FACEBOOK_CLIENT_SECRET,
    };
    logger.startup('  OAuth provider: Facebook');
  }

  if (process.env.NOMAD_OAUTH_TWITTER_CLIENT_ID && process.env.NOMAD_OAUTH_TWITTER_CLIENT_SECRET) {
    providers.twitter = {
      clientId: process.env.NOMAD_OAUTH_TWITTER_CLIENT_ID,
      clientSecret: process.env.NOMAD_OAUTH_TWITTER_CLIENT_SECRET,
    };
    logger.startup('  OAuth provider: Twitter/X');
  }

  return providers;
}

/**
 * Resolve the SQLite database path for Better Auth.
 * Uses the same data directory as Nomad's main database.
 */
/**
 * Resolve the origins better-auth will accept a sign-in from (refs #380).
 *
 * `baseURL` alone is correct only when the backend serves the frontend from
 * the same origin. In development the frontend runs on vite and proxies to the
 * API, so the browser's Origin never matches, every sign-in returns 403, and
 * nothing appears in the UI -- which made OAuth impossible to exercise in dev
 * from the moment the mode was added. Any split-origin deployment, where the
 * frontend terminates on a different host or port than the API, has the same
 * shape.
 *
 * Widening this is only safe if it cannot be widened into "trust anything", so
 * the failures here are deliberate and loud:
 *
 *   - the baseURL is always trusted and cannot be configured away
 *   - a malformed entry throws rather than being skipped; a silently dropped
 *     origin looks exactly like a correct configuration until sign-in fails
 *   - a wildcard is refused, not honoured
 *
 * @param baseURL the backend's own public URL, always trusted
 * @param configured raw NOMAD_TRUSTED_ORIGINS value, comma-separated
 */
export function resolveTrustedOrigins(
  baseURL: string,
  configured: string | undefined
): string[] {
  const origins = [baseURL];

  if (!configured || !configured.trim()) {
    return origins;
  }

  for (const raw of configured.split(',')) {
    const entry = raw.trim();
    if (!entry) {
      continue;
    }

    if (entry.includes('*')) {
      throw new Error(
        `Invalid NOMAD_TRUSTED_ORIGINS entry "${entry}": wildcards are not ` +
          'accepted. Trusting any origin defeats the check entirely; list each ' +
          'origin explicitly.'
      );
    }

    let parsed: URL;
    try {
      parsed = new URL(entry);
    } catch {
      throw new Error(
        `Invalid NOMAD_TRUSTED_ORIGINS entry "${entry}": not a URL. Expected ` +
          'scheme://host[:port], for example http://localhost:5177.'
      );
    }

    if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error(
        `Invalid NOMAD_TRUSTED_ORIGINS entry "${entry}": an Origin is scheme, ` +
          'host and port only. A path here would never match, and the origin ' +
          'would be silently ignored.'
      );
    }

    // new URL("http://a:80").origin normalises the default port away, which is
    // what a browser actually sends, so compare on the normalised form.
    if (!origins.includes(parsed.origin)) {
      origins.push(parsed.origin);
    }
  }

  return origins;
}


function resolveAuthDbPath(): string {
  const dataPath = process.env.NOMAD_DATA_PATH
    || process.env.FIRESTARR_DATASET_PATH
    || process.cwd();
  return resolve(dataPath, 'nomad_auth.db');
}

/**
 * Initialize Better Auth. Call once at startup when NOMAD_AUTH_MODE=oauth.
 * Throws if no providers are configured.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function initBetterAuth(): Promise<any> {
  if (authInstance) return authInstance;

  const socialProviders = buildSocialProviders();
  const providerCount = Object.keys(socialProviders ?? {}).length;

  if (providerCount === 0) {
    throw new Error(
      'NOMAD_AUTH_MODE=oauth but no OAuth providers configured. ' +
      'Set at least one provider (NOMAD_OAUTH_GOOGLE_CLIENT_ID/SECRET, ' +
      'NOMAD_OAUTH_MICROSOFT_CLIENT_ID/SECRET, or NOMAD_OAUTH_GITHUB_CLIENT_ID/SECRET).'
    );
  }

  const dbPath = resolveAuthDbPath();
  logger.startup(`  OAuth database: ${dbPath}`);

  // Session signing secret — use env var or generate a stable one from the DB path
  const secret = process.env.NOMAD_OAUTH_SECRET
    || process.env.BETTER_AUTH_SECRET
    || createHash('sha256').update(dbPath + 'nomad-oauth').digest('hex');

  // Determine the public-facing URL for OAuth callbacks.
  // The installer sets NOMAD_SERVER_HOSTNAME. The public port is:
  //   Docker: NOMAD_FRONTEND_HOST_PORT (what the browser hits)
  //   Metal:  PORT (backend serves frontend same-origin)
  const hostname = process.env.NOMAD_SERVER_HOSTNAME || 'localhost';
  const publicPort = process.env.NOMAD_FRONTEND_HOST_PORT || process.env.PORT || '3001';
  const baseURL = process.env.BETTER_AUTH_URL || `http://${hostname}:${publicPort}`;
  logger.startup(`  OAuth base URL: ${baseURL}`);

  authInstance = betterAuth({
    database: new Database(dbPath),
    secret,
    baseURL,
    basePath: '/api/auth',
    trustedOrigins: resolveTrustedOrigins(baseURL, process.env.NOMAD_TRUSTED_ORIGINS),
    socialProviders,
    user: {
      modelName: 'auth_user',
    },
    session: {
      modelName: 'auth_session',
    },
    databaseHooks: {
      session: {
        delete: {
          // Sign-out. The hook hands back a session carrying only a userId,
          // while every other event in the usage log is keyed on email - so the
          // email is resolved from the tracker the session middleware populates.
          after: async (session: { id?: string; token?: string }) => {
            await recordLogout(session);
          },
        },
      },
    },
  });

  // Auto-create Better Auth tables if they don't exist
  const { runMigrations } = await (await import('better-auth/db/migration')).getMigrations(authInstance.options);
  await runMigrations();
  logger.startup('  OAuth database tables verified');

  logger.startup(`  OAuth initialized with ${providerCount} provider(s)`);
  return authInstance;
}

/**
 * Get the initialized Better Auth instance.
 * Returns null if OAuth is not enabled.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getBetterAuth(): any | null {
  return authInstance;
}

/**
 * Reset the auth instance (for testing).
 */
export function resetBetterAuth(): void {
  authInstance = null;
}
