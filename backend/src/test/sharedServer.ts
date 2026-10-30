/**
 * One listening server per test file, instead of one per request (#480).
 *
 * THE DEFECT THIS EXISTS TO REMOVE. Handing supertest an express app makes it
 * call `app.listen(0)` on EVERY request — measured by counting `listen()`
 * directly, five requests against one shared app object produced five listens,
 * while five against an already-listening `http.Server` produced zero. So the
 * suite was creating on the order of 1300 ephemeral servers per run, each one a
 * fresh client/server port pair.
 *
 * Why that is not merely wasteful: the fault needs one of those pairs' 4-tuples
 * to collide with an existing loopback connection belonging to an UNRELATED
 * process on the machine. `lsof` at the instant of each anomaly named the
 * holder every time — a VS Code helper, `limactl`, a device-manager daemon — 7
 * anomalies against 19,213 clean requests. On one stall lsof showed
 * `other 127.0.0.1:62314->127.0.0.1:62447` and
 * `node 127.0.0.1:62447->127.0.0.1:62314` simultaneously: the same four
 * numbers, mirrored.
 *
 * The request then goes to the stranger, which is why one fault wears five
 * faces — it rejects our JSON (400), demands auth (401), has no such route
 * (404), does not speak HTTP (HPE_INVALID_CONSTANT), or accepts and never
 * answers (a 30s stall). Every past diagnosis of #480/#405/#491 looked for the
 * cause inside this codebase; it was never here.
 *
 * MEASURED, interleaved against an unchanged control, 19,200 requests per arm:
 *
 *   app per request   5 stalls, 3 framing anomalies
 *   shared server     0 stalls, 0 framing anomalies   (28,800 cumulative, zero)
 *
 * A FIX THAT DOES NOT WORK, recorded so it is not tried again:
 * `app.listen(0, '127.0.0.1')` — binding the stack we actually connect on.
 * 7 stalls / 11 framing versus the control's 6 / 7. The collision is in the
 * 4-tuple, so address family was never the variable.
 *
 * NOTE ON RATES: because the collision requires a foreign process on the same
 * host, CI and developer machines will see different rates. A quiet CI run is
 * not evidence that the old pattern is safe.
 *
 * USAGE — one server for the file, torn down after it:
 *
 *   const api = serveOnce(buildApp);
 *   it('...', async () => { await request(api()).get('/health'); });
 *
 * `serveOnce` is lazy: nothing listens until the first request, so a file that
 * skips every test opens no socket.
 */

import type { Server } from 'node:http';
import type { Express } from 'express';
import { afterAll } from 'vitest';

/**
 * Creates the server on first use, reuses it for the rest of the file, and
 * closes it afterwards.
 *
 * Pass the FACTORY, not an app — a factory makes it explicit that the app is
 * built once. A file whose app differs per test must not use this; see
 * `serveForTest`.
 */
export function serveOnce(buildApp: () => Express): () => Server {
  let server: Server | undefined;

  afterAll(async () => {
    if (!server) return;
    const s = server;
    server = undefined;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  });

  return () => {
    // `listen(0)` once. Every subsequent request reuses this server, so no new
    // port pair is created and there is nothing to collide.
    server ??= buildApp().listen(0);
    return server;
  };
}

/**
 * For a file that genuinely needs a differently-configured app per test: one
 * server for THAT test, closed when it ends, rather than one per request.
 *
 * This is a smaller win than `serveOnce` and it is deliberately a separate
 * function rather than a default — a test making a single request gains
 * nothing from it, and calling it per request would reintroduce the defect
 * exactly.
 */
export function serveForTest(app: Express): { server: Server; close: () => Promise<void> } {
  const server = app.listen(0);
  return {
    server,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
