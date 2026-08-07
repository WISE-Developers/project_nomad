/**
 * Sentry integration for the Nomad backend (#313, S2).
 *
 * Backend Sentry only runs on Nomad's own (SAN) Express server — in ACN the
 * agency owns the backend. The gate is therefore just DSN presence: the
 * installer consent prompt decides whether SENTRY_DSN is set, so no DSN means
 * the backend never phones home. v1 scope: errors only (no tracing/profiling).
 */

import * as Sentry from '@sentry/node';
import type { Express } from 'express';

export function shouldInitSentryBackend({ dsn }: { dsn?: string }): boolean {
  return !!dsn;
}

/** Minimal structural shape of a Sentry event we scrub. */
export interface SentryEventLike {
  user?: unknown;
  server_name?: unknown;
  request?: { url?: string; data?: unknown } & Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Redact PII / sensitive payloads before an event leaves the server.
 * Never drops the event — scrubbing only.
 */
export function scrubEvent(event: SentryEventLike): SentryEventLike {
  if ('user' in event) delete event.user; // username / email / ip
  if ('server_name' in event) delete event.server_name; // host / path leakage
  if (event.request && typeof event.request === 'object' && 'data' in event.request) {
    event.request.data = '[redacted]'; // model inputs (geometry, paths, weather)
  }
  return event;
}

export interface InitSentryOptions {
  dsn?: string;
  environment?: string;
  release?: string;
}

/**
 * Initialise backend Sentry iff a DSN is configured. Returns whether it
 * initialised. Safe to call unconditionally — no-op when no DSN.
 * Call as early as possible in startup (after env is loaded).
 */
export function initSentry(opts: InitSentryOptions): boolean {
  if (!shouldInitSentryBackend(opts)) return false;

  Sentry.init({
    dsn: opts.dsn,
    environment: opts.environment ?? 'development',
    release: opts.release,
    // v1: errors only — keep default integrations (error/rejection capture),
    // add no tracing or profiling.
    tracesSampleRate: 0,
    beforeSend: (event) =>
      scrubEvent(event as unknown as SentryEventLike) as unknown as Sentry.ErrorEvent,
  });
  return true;
}

/**
 * Register Sentry's Express error handler. Must be called AFTER all routes are
 * mounted and BEFORE the app's own error-formatting middleware. No-op if Sentry
 * was not initialised.
 */
export function setupSentryErrorHandler(app: Express): void {
  Sentry.setupExpressErrorHandler(app);
}
