/**
 * Tests for backend Sentry gating + scrubbing (Nomad #313, S2).
 *
 * Backend Sentry only runs on Nomad's own (SAN) Express server — in ACN the
 * agency owns the backend — so the gate is simply DSN presence (the installer
 * consent prompt controls whether a DSN is set). No DSN → no reporting.
 */

import { describe, it, expect } from 'vitest';
import { shouldInitSentryBackend, scrubEvent } from '../sentry.js';

describe('shouldInitSentryBackend', () => {
  it('does not init without a DSN', () => {
    expect(shouldInitSentryBackend({ dsn: undefined })).toBe(false);
    expect(shouldInitSentryBackend({ dsn: '' })).toBe(false);
  });

  it('inits when a DSN is configured', () => {
    expect(shouldInitSentryBackend({ dsn: 'https://k@o1.ingest.sentry.io/1' })).toBe(true);
  });
});

describe('scrubEvent (PII redaction in beforeSend)', () => {
  it('strips user identity', () => {
    expect(scrubEvent({ user: { username: 'franco', email: 'f@x.ca' } }).user).toBeUndefined();
  });

  it('strips server_name (host / path leakage)', () => {
    expect(scrubEvent({ server_name: 'nomad-host' }).server_name).toBeUndefined();
  });

  it('redacts request body data', () => {
    const e = scrubEvent({ request: { url: '/api/v1/models', data: { ignition: 'x' } } });
    expect(e.request?.data).toBe('[redacted]');
    expect(e.request?.url).toBe('/api/v1/models');
  });

  it('passes a clean event through unchanged', () => {
    expect(scrubEvent({ message: 'boom', level: 'error' })).toEqual({ message: 'boom', level: 'error' });
  });
});
