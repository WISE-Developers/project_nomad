/**
 * Asserts the #480 band, because "binds outside the ephemeral range" is the
 * whole fix and nothing else in the suite would notice if it stopped.
 *
 * The band is the measured variable: a 3-cell factorial of 19,200 requests each
 * put the control (ephemeral) at 8 stalls + 3 spurious 400s and both
 * out-of-range cells at zero. If a refactor quietly returns these servers to
 * listen(0), the suite goes back to failing about 1 run in 8 and the cause will
 * look new again.
 *
 * Mutation-tested: pointing serveOnce back at listen(0) makes the port
 * assertion fail with the real ephemeral port in the message.
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { serveOnce, bandInfo } from '../sharedServer.js';

/** Below Linux's usual 32768 as well as macOS's 49152. */
const LINUX_EPHEMERAL_FLOOR = 32768;

function buildApp() {
  const app = express();
  app.get('/band', (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

const api = serveOnce(buildApp);

describe('#480 shared server binds outside the ephemeral range', () => {
  it('serves normally — the fix must not cost us working requests', async () => {
    const res = await request(api()).get('/band');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('bound a port inside this worker band, below every ephemeral floor', () => {
    const address = api().address();
    expect(address, 'no address — the bind failed').not.toBeNull();

    const { port } = address as { port: number };
    expect(
      port,
      `bound ${port}; expected this worker's band ${bandInfo.lo}-${bandInfo.hi}. ` +
        'A port at or above 32768 means these servers are back on listen(0) and #480 is live again.',
    ).toBeGreaterThanOrEqual(bandInfo.lo);
    expect(port).toBeLessThanOrEqual(bandInfo.hi);
    expect(port).toBeLessThan(LINUX_EPHEMERAL_FLOOR);
  });

  it('did not fall back to listen(0) — the fallback is silent by design', () => {
    // The fallback exists so a full band never fails a test. That makes it
    // invisible, so it is asserted rather than trusted.
    expect(bandInfo.fellBack, 'the band was exhausted and servers silently returned to listen(0)').toBe(0);
    expect(bandInfo.binds).toBeGreaterThan(0);
  });
});
