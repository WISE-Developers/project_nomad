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
/**
 * `Application`, not `Express`. The suite declares its apps as
 * `express.Application`, and `Express` is the narrower
 * `Application & { request, response }` that only `express()` itself returns —
 * so typing this as `Express` rejected six files. `listen` lives on
 * `Application`, which is all this helper needs.
 *
 * tsc caught that while 85 tests through these very servers passed. Three
 * gates, three answers.
 */
import type { Application } from 'express';
import { afterAll } from 'vitest';

/**
 * Binds OUTSIDE the OS ephemeral port range, which is the variable that
 * actually matters (#480).
 *
 * Measured 2026-10-31, a 3-cell factorial of 19,200 requests each interleaved
 * with an untouched control in the same session, after an earlier run was
 * voided by self-inflicted port exhaustion:
 *
 *   listen(0)          ephemeral, dual-stack   8 stalls + 3 spurious 400s
 *   listen(band)       20000+,    dual-stack   0          0
 *   listen(band, v4)   20000+,    IPv4         0          0
 *
 * Address family is NOT the variable -- both out-of-range cells are clean,
 * which retires an earlier wrong turn where an explicit IPv4 bind alone changed
 * nothing. The ephemeral range is where the OS hands every other process its
 * client source ports, so staying out of it removes the thing to collide with.
 *
 * WHY THIS LIVES HERE AND NOT IN A GLOBAL listen() SHIM. A shim would fix all
 * 184 call sites touching none, and it measured 0 stalls in 19,200 in
 * isolation -- then broke the real suite in 10 of 10 runs, 37 to 136 failures
 * each. Cause: its retry called listen() a SECOND time on the same server
 * object, which throws ERR_SERVER_ALREADY_LISTEN when the first bind is still
 * pending, and that throw escapes through app.listen(0) into the test. Here the
 * factory is ours, so a retry builds a FRESH app and there is no such state.
 *
 * The band stays under 32768 so it is below Linux's usual ephemeral floor as
 * well as macOS's 49152: 16 workers x 800 = 16384..29183.
 */
const SLICE = 800;
/**
 * 16384, not 20000. At 20000 the sixteenth worker's slice is 32000-32799, and
 * 32799 is ABOVE Linux's usual ephemeral floor of 32768 — so that worker would
 * have been allocating ports inside the very range this exists to avoid, and
 * `sharedServerBand.test.ts` would have failed on a 16-worker Linux runner.
 * CI passed only because it used fewer workers, which is luck rather than
 * correctness. At 16384 the top of the band is 29183, clear of both floors,
 * and still above the privileged range and the usual dev ports.
 */
const BAND_BASE = 16384;
const workerId = Number(process.env.VITEST_WORKER_ID ?? 1) || 1;
const bandLo = BAND_BASE + ((workerId - 1) % 16) * SLICE;
let cursor = bandLo;

/** Exposed so the band can be asserted rather than assumed. */
export const bandInfo = { lo: bandLo, hi: bandLo + SLICE - 1, binds: 0, retries: 0, fellBack: 0 };

/**
 * Listen on a band port, retrying with a FRESH app on each failure.
 *
 * `listen(port)` with no host binds synchronously, so a non-null `address()`
 * means success and null means the port was taken -- `listen()` never throws on
 * EADDRINUSE, it emits 'error' later, which is why the result is read from
 * address() instead of a try/catch.
 */
function listenInBand(buildApp: () => Application): Server {
  for (let attempt = 0; attempt < SLICE; attempt += 1) {
    const port = (cursor = cursor >= bandInfo.hi ? bandLo : cursor + 1);
    const candidate = buildApp().listen(port);
    // Swallow the late EADDRINUSE so an abandoned server cannot surface it.
    candidate.on('error', (err: NodeJS.ErrnoException) => {
      if (err?.code !== 'EADDRINUSE') throw err;
    });
    if (candidate.address()) {
      bandInfo.binds += 1;
      return candidate;
    }
    bandInfo.retries += 1;
    try { candidate.close(); } catch { /* was never listening */ }
  }
  bandInfo.fellBack += 1;
  return buildApp().listen(0); // old behaviour rather than a failed test
}

/**
 * Creates the server on first use, reuses it for the rest of the file, and
 * closes it afterwards.
 *
 * Pass the FACTORY, not an app — a factory makes it explicit that the app is
 * built once. A file whose app differs per test must not use this; see
 * `serveForTest`.
 */
export function serveOnce(buildApp: () => Application): () => Server {
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
    server ??= listenInBand(buildApp);
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
export function serveForTest(app: Application): { server: Server; close: () => Promise<void> } {
  // An app instance, not a factory, so there is nothing to rebuild on a port
  // clash -- this one takes listen(0) and keeps the old exposure.
  const server = app.listen(0);
  return {
    server,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * One server per distinct ARGUMENT, for a factory parameterised by a scalar.
 *
 * `adhocLayers.test.ts` calls `buildApp('dylan')` seven times,
 * `buildApp(undefined)` four times and `buildApp('franco')` three times. Those
 * are not fifteen different apps, they are three — so fifteen ephemeral port
 * pairs become three servers, memoised by key.
 *
 * This does NOT help a factory parameterised by an object (`buildApp({ catalog
 * })`, `makeApp({ logger })`): those genuinely differ per test and there is no
 * key to memoise on. Reducing those needs the test redesigned so the app is
 * built once and the varying part injected per request — a judgement call about
 * test design, deliberately not papered over here.
 */
export function serveKeyed<K extends string | number | undefined>(
  buildApp: (key: K) => Application,
): (key: K) => Server {
  const servers = new Map<string, Server>();

  afterAll(async () => {
    const open = [...servers.values()];
    servers.clear();
    await Promise.all(open.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  });

  return (key: K) => {
    const id = String(key);
    let server = servers.get(id);
    if (!server) {
      server = listenInBand(() => buildApp(key));
      servers.set(id, server);
    }
    return server;
  };
}
