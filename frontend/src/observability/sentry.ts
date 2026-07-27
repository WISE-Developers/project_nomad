/**
 * Sentry integration for the Nomad frontend (#313).
 *
 * Governed by the SAN/ACN cardinal rule ("features must never assume SAN"):
 * - DSN-gated: no DSN → Sentry is a no-op (air-gapped / unconfigured).
 * - SAN (not embedded): initialise when a DSN is present.
 * - ACN (embedded in an agency app): default OFF — the host app likely runs its
 *   own Sentry; only initialise if the host explicitly opts in via the adapter.
 *
 * v1 scope: errors only (no Session Replay, no performance tracing).
 * The gating decision and PII scrub are pure functions (unit-tested) so the
 * policy is provable independently of the Sentry SDK.
 */

import * as Sentry from '@sentry/react';

export interface SentryGateInput {
  /** VITE_SENTRY_DSN, or undefined/empty when unset */
  dsn?: string;
  /** true when running embedded (ACN / openNomad host) */
  embedded: boolean;
  /** ACN host has explicitly opted in to Nomad-side Sentry */
  hostOptIn?: boolean;
}

/**
 * Decide whether Sentry should initialise, per the SAN/ACN/air-gap rules.
 */
export function shouldInitSentry({ dsn, embedded, hostOptIn }: SentryGateInput): boolean {
  if (!dsn) return false; // air-gapped / unconfigured → cleanly off
  if (!embedded) return true; // SAN owns its own surface
  return hostOptIn === true; // ACN: only when the host opts in
}

/** Minimal structural shape of a Sentry event we scrub. */
export interface SentryEventLike {
  user?: unknown;
  server_name?: unknown;
  request?: { url?: string; data?: unknown } & Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Redact PII / sensitive payloads before an event leaves the browser.
 * Never drops the event — scrubbing only. (Dropping is a separate concern.)
 */
export function scrubEvent(event: SentryEventLike): SentryEventLike {
  if ('user' in event) delete event.user; // username / email / ip
  if ('server_name' in event) delete event.server_name; // host / path leakage
  if (event.request && typeof event.request === 'object' && 'data' in event.request) {
    event.request.data = '[redacted]'; // model inputs (geometry, paths, weather)
  }
  return event;
}

export interface InitSentryOptions extends SentryGateInput {
  environment?: string;
  release?: string;
}

/**
 * Initialise Sentry iff the gate allows it. Returns whether it initialised.
 * Safe to call unconditionally — it's a no-op when the gate says off.
 */
export function initSentry(opts: InitSentryOptions): boolean {
  if (!shouldInitSentry(opts)) return false;

  Sentry.init({
    dsn: opts.dsn,
    environment: opts.environment ?? 'development',
    release: opts.release,
    // v1: errors only — no Replay, no tracing.
    integrations: [],
    tracesSampleRate: 0,
    beforeSend: (event) =>
      scrubEvent(event as unknown as SentryEventLike) as unknown as Sentry.ErrorEvent,
  });
  return true;
}

/** Re-exported so callers wrap the app without importing the SDK directly. */
export const SentryErrorBoundary = Sentry.ErrorBoundary;
