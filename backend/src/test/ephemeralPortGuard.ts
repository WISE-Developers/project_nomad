/**
 * Keeps every test server OUT of the OS ephemeral port range (#480).
 *
 * THE CAUSE, measured rather than argued. supertest calls `app.listen(0)` on
 * every request — 5 requests against one shared app object produce 5 listens,
 * counted directly — so the suite creates on the order of 1300 ephemeral
 * client/server port pairs per run. The OS draws those from the same range it
 * hands every other process on the machine as client source ports
 * (49152–65535 on macOS; `sysctl net.inet.ip.portrange.first`). When one of our
 * pairs collides with a loopback connection belonging to an unrelated process,
 * the request goes to that stranger — which rejects our JSON (400), demands
 * auth (401), has no such route (404), does not speak HTTP
 * (HPE_INVALID_CONSTANT), or accepts and never answers (a 30s stall).
 *
 * That is one fault wearing five faces, and it is why #480, #405 and #491 were
 * the same defect. Every earlier diagnosis looked for a cause inside this
 * codebase. It was never here: the probe that reproduces it is a one-route
 * express app with no database and no filesystem.
 *
 * THE EVIDENCE FOR THIS FIX, a 3-cell factorial plus this shim, each cell
 * 19,200 requests, interleaved with an untouched control in the same session:
 *
 *   listen(0)            ephemeral, dual-stack   8 stalls + 3 spurious 400s
 *   listen(band)         20000+,    dual-stack   0          0
 *   listen(band, v4)     20000+,    IPv4         0          0
 *   this shim            20000+                  0          0
 *
 * 0 stalls in 57,600 out-of-range requests against 24 in the matched controls.
 * ADDRESS FAMILY IS NOT THE VARIABLE — both out-of-range arms are clean, which
 * retires an earlier wrong turn where an explicit IPv4 bind was tried on its
 * own and changed nothing (7 stalls / 11 framing vs a control's 6 / 7).
 *
 * WHY A SHIM RATHER THAN CONVERTING THE CALL SITES. supertest does the listening
 * itself, at 184 sites. Converting them to share one server per file helps —
 * fewer pairs means fewer collisions — but it is a MITIGATION, not a cure: a
 * shared pair can still be the unlucky one, and when it is, every test in that
 * file stalls together. That was observed, not predicted: 7 tests in
 * usage.test.ts failed at once, all through a shared server. This changes the
 * variable that actually matters and needs no call site touched.
 *
 * TWO CONSTRAINTS THIS IMPLEMENTATION OBEYS, both learned by getting them wrong:
 *
 *  1. THE BIND MUST BE SYNCHRONOUS. supertest reads `.address()` on the line
 *     after `listen()`. Passing a host string makes Node defer the bind behind
 *     a lookup, so `address()` returns null and supertest throws
 *     "Cannot read properties of null (reading 'address')". So: `listen(port)`
 *     with no host. The factorial shows dual-stack out-of-range is clean, so
 *     omitting the host costs nothing.
 *
 *  2. `listen()` DOES NOT THROW ON EADDRINUSE — it emits 'error'
 *     asynchronously. An earlier attempt wrapped it in try/catch, caught
 *     nothing, and happily issued requests against servers whose bind had
 *     FAILED. Here a successful bind is recognised by `address()` being
 *     non-null, and the late 'error' is swallowed for the life of the server so
 *     it cannot surface as a request failure. Without that swallow the shim
 *     leaked 4 EADDRINUSE into 19,200 requests.
 *
 * Each worker gets a DISJOINT slice keyed off VITEST_WORKER_ID, not a pid
 * modulus — a modulus collides, and an earlier run read "0 anomalies in 11,200"
 * only because 20 of its 48 workers had died unseen.
 *
 * It never fails a test over a port: if a whole slice is somehow unusable it
 * falls back to `listen(0)`, which is merely the old behaviour.
 */

import net from 'node:net';

/** Ports per worker. 2000 is ample: servers here close after each request. */
const SLICE = 2000;

/**
 * Base of the private band. Must stay below the ephemeral floor — 49152 on
 * macOS and 32768 on most Linux (`net.ipv4.ip_local_port_range`), so 20000 is
 * below both, and 20000 + 12 workers * 2000 = 44000 stays under 49152.
 */
const BAND_BASE = 20000;

/**
 * Vitest numbers its workers from 1 and sets this in every pool. Absent (a
 * direct `node` run), worker 1 is correct because there is only one.
 */
const workerId = Number(process.env.VITEST_WORKER_ID ?? process.env.VITEST_POOL_ID ?? 1) || 1;

const lo = BAND_BASE + (workerId - 1) * SLICE;
const hi = lo + SLICE - 1;
let cursor = lo;

const nextPort = (): number => (cursor = cursor >= hi ? lo : cursor + 1);

/** Observable for the guard's own test — an instrument that cannot be checked is not one. */
export const portGuardStats = { installed: false, binds: 0, retries: 0, fellBack: 0, lo, hi };

const originalListen = net.Server.prototype.listen;

/**
 * Only the "any free port" form is redirected. An explicit port is somebody
 * deliberately asking for that port and must be left alone.
 */
net.Server.prototype.listen = function patchedListen(
  this: net.Server,
  ...args: Parameters<typeof originalListen>
): net.Server {
  const [first] = args;
  if (first !== 0 && first !== undefined) {
    return originalListen.apply(this, args) as net.Server;
  }

  const callbacks = args.slice(1).filter((a): a is () => void => typeof a === 'function');

  // Swallow a late EADDRINUSE for the whole life of this server. The error
  // arrives after listen() has returned, so it cannot be handled by retrying
  // around the call — and if it reaches the request it reads as a test failure.
  const swallow = (err: NodeJS.ErrnoException): void => {
    if (err?.code !== 'EADDRINUSE') this.emit('error:unhandled', err);
  };
  this.on('error', swallow);

  for (let attempt = 0; attempt < SLICE; attempt += 1) {
    originalListen.call(this, nextPort(), ...callbacks);
    // A synchronous bind means address() is already populated. Null means the
    // port was taken and the 'error' event is on its way.
    if (this.address()) {
      portGuardStats.binds += 1;
      return this;
    }
    portGuardStats.retries += 1;
  }

  // Whole slice unusable. Fall back to the old behaviour rather than fail.
  portGuardStats.fellBack += 1;
  return originalListen.call(this, 0, ...callbacks) as net.Server;
} as typeof originalListen;

portGuardStats.installed = true;
