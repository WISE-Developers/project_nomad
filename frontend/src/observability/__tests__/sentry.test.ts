/**
 * Tests for Sentry gating (Nomad #313)
 *
 * shouldInitSentry enforces the SAN/ACN/air-gap rules:
 * - No DSN  → never init (air-gapped / unconfigured → cleanly off)
 * - SAN + DSN → init
 * - ACN (embedded) + DSN, host has NOT opted in → do NOT init
 *   (the agency app likely runs its own Sentry; don't double-report or leak)
 * - ACN (embedded) + DSN + host opt-in → init
 */

import { describe, it, expect } from 'vitest';
import { shouldInitSentry, scrubEvent } from '../sentry.js';

describe('shouldInitSentry', () => {
  it('never initialises without a DSN (air-gapped / unconfigured)', () => {
    expect(shouldInitSentry({ dsn: undefined, embedded: false })).toBe(false);
    expect(shouldInitSentry({ dsn: '', embedded: false })).toBe(false);
    expect(shouldInitSentry({ dsn: '', embedded: true, hostOptIn: true })).toBe(false);
  });

  it('initialises in SAN (not embedded) when a DSN is present', () => {
    expect(shouldInitSentry({ dsn: 'https://k@o1.ingest.sentry.io/1', embedded: false })).toBe(true);
  });

  it('does NOT initialise in ACN (embedded) unless the host opts in', () => {
    const dsn = 'https://k@o1.ingest.sentry.io/1';
    expect(shouldInitSentry({ dsn, embedded: true })).toBe(false);
    expect(shouldInitSentry({ dsn, embedded: true, hostOptIn: false })).toBe(false);
  });

  it('initialises in ACN (embedded) when the host explicitly opts in', () => {
    const dsn = 'https://k@o1.ingest.sentry.io/1';
    expect(shouldInitSentry({ dsn, embedded: true, hostOptIn: true })).toBe(true);
  });
});

describe('scrubEvent (PII redaction in beforeSend)', () => {
  it('strips user identity (username / email / ip)', () => {
    const e = scrubEvent({ user: { username: 'franco', email: 'f@x.ca', ip_address: '1.2.3.4' } });
    expect(e?.user).toBeUndefined();
  });

  it('strips server_name (host / path leakage)', () => {
    const e = scrubEvent({ server_name: 'franco-macbook.local' });
    expect(e?.server_name).toBeUndefined();
  });

  it('redacts request body data (model inputs may contain sensitive geometry/paths)', () => {
    const e = scrubEvent({ request: { url: '/api/v1/models', data: { ignition: 'secret-geojson' } } });
    expect(e?.request?.data).toBe('[redacted]');
    // non-sensitive request metadata (url) is preserved
    expect(e?.request?.url).toBe('/api/v1/models');
  });

  it('passes a clean event through unchanged', () => {
    const e = scrubEvent({ message: 'boom', level: 'error' });
    expect(e).toEqual({ message: 'boom', level: 'error' });
  });

  it('returns the event object (never drops) for scrubbing', () => {
    expect(scrubEvent({})).not.toBeNull();
  });
});
