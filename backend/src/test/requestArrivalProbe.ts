/**
 * #480 probe — did the HTTP request ever REACH the server?
 *
 * The watchdog (#405) answers "what is still pending" and has now recorded the
 * same tally at every stall across at least five unrelated files:
 *
 *   PipeWrap=4 Socket=4 TCPServerWrap=1 TCPSocketWrap=1 Pipe=1 Server=1
 *
 * A listening server, one accepted socket, no ConnectWrap — so the client
 * finished connecting and the response never came. That is consistent with two
 * very different faults, and the handle names cannot tell them apart:
 *
 *   A. the request arrived and the handler never responded
 *   B. the socket connected but no request was ever delivered to the server
 *
 * This records a timestamped line per `request` and per `response finish` on
 * every http.Server created in the process. Cross-referenced with the
 * watchdog's stall line, a stalled test shows either an arrival with no finish
 * (A) or no arrival at all (B).
 *
 * Opt-in via NOMAD_TEST_ARRIVAL_PROBE=1, no-op otherwise, so ordinary runs and
 * CI are untouched. It must not change what it measures: the patch only adds a
 * listener and appends to a file, and it never holds the event loop open.
 */

import http from 'node:http';
import { appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const enabled = process.env.NOMAD_TEST_ARRIVAL_PROBE === '1';

/**
 * Second stage, added once the first answered its question.
 *
 * The arrival log showed the stalled test's request is the ONE request missing
 * from the server side, with zero unfinished requests anywhere — so it is never
 * delivered at all. That moves the suspect to the client: supertest's `end()`
 * dispatches immediately only when its per-server `state.starting` is false, and
 * otherwise waits for a `listening` event. A request that is never dispatched
 * produces exactly the observed signature.
 *
 * So record the branch `end()` takes and whether a dispatch ever follows. A
 * stalled request should appear as DISPATCH-DEFERRED with no matching
 * DISPATCH-SENT.
 */
const DISPATCH_PROBE = process.env.NOMAD_TEST_DISPATCH_PROBE === '1';

if (enabled) {
  const reportPath = process.env.NOMAD_TEST_ARRIVAL_FILE ?? '/tmp/nomad-arrivals.log';
  const origCreateServer = http.createServer.bind(http);

  let seq = 0;

  const record = (line: string) => {
    try {
      appendFileSync(reportPath, line + '\n');
    } catch {
      // A probe that throws would fail the test it is observing.
    }
  };

  // @ts-expect-error -- deliberate monkey-patch of a Node builtin, test-only.
  http.createServer = (...args: Parameters<typeof http.createServer>) => {
    const server = origCreateServer(...args);

    server.on('request', (req, res) => {
      const id = ++seq;
      const label = `${req.method} ${req.url}`;
      record(`[${new Date().toISOString()}] ARRIVED  #${id} ${label}`);
      res.on('finish', () => {
        record(`[${new Date().toISOString()}] FINISHED #${id} ${label} -> ${res.statusCode}`);
      });
      res.on('close', () => {
        if (!res.writableEnded) {
          record(`[${new Date().toISOString()}] ABORTED  #${id} ${label}`);
        }
      });
    });

    return server;
  };
}

if (DISPATCH_PROBE) {
  const reportPath = process.env.NOMAD_TEST_DISPATCH_FILE ?? '/tmp/nomad-dispatch.log';

  const record = (line: string) => {
    try {
      appendFileSync(reportPath, `[${new Date().toISOString()}] ${line}\n`);
    } catch {
      // A probe that throws would fail the test it is observing.
    }
  };

  // supertest is CommonJS and this file is ESM, so `require` is not in scope.
  // createRequire gives the exact same module instance supertest itself uses,
  // which matters: patching a second copy would observe nothing and read as a
  // clean negative.
  const nodeRequire = createRequire(import.meta.url);
  const Test = nodeRequire('supertest/lib/test.js');
  const origEnd = Test.prototype.end;
  let seq = 0;

  Test.prototype.end = function patchedEnd(this: Record<string, unknown>, fn: unknown) {
    const id = ++seq;
    const server = this._server as { listening?: boolean; address?: () => unknown } | undefined;
    const method = (this as { method?: string }).method ?? '?';
    const url = (this as { url?: string }).url ?? '?';
    const label = `#${id} ${method} ${url}`;

    // `listening` is Node's own view, independent of supertest's bookkeeping —
    // a disagreement between the two is itself the finding.
    record(
      `END     ${label} hasServer=${Boolean(server)} nodeListening=${server?.listening ?? 'n/a'}`,
    );

    const settled = () => record(`SETTLED ${label}`);

    const wrapped = function (this: unknown, ...args: unknown[]) {
      settled();
      return typeof fn === 'function' ? (fn as (...a: unknown[]) => unknown).apply(this, args) : undefined;
    };

    const out = origEnd.call(this, wrapped);
    record(`RETURN  ${label}`);
    return out;
  };
}
