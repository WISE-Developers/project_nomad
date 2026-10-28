/**
 * #480 probe, third stage — A CORRELATED, PER-REQUEST SOCKET TRACE.
 *
 * WHY THE FIRST TWO STAGES GAVE WRONG ANSWERS, which is the whole reason this
 * file exists and is worth reading before trusting it:
 *
 * `requestArrivalProbe.ts` logs arrivals with a server-side counter (`++seq`)
 * and dispatches with a separate client-side counter. **The two logs share no
 * identity.** So "the stalled test's request is the ONE request missing from the
 * server side" was never an observation about a particular request — it was
 * arithmetic over two independent tallies. I published "the request is never
 * delivered" on the strength of it and had to retract on the issue, because a
 * clean run showed the same one-request deficit. The noise was the size of the
 * signal.
 *
 * Counting has now produced two wrong answers here. This stage stops counting.
 *
 * HOW: every outbound request gets a unique id, carried in a header, and BOTH
 * sides log against that id. A stalled request is then identified by name, and
 * its lifecycle is readable as a sequence of stages rather than inferred from
 * totals:
 *
 *   CLIENT-CREATE      http.request() returned a ClientRequest
 *   CLIENT-SOCKET      a socket was assigned
 *   SOCKET-CONNECT     that socket connected
 *   CLIENT-FINISH      the request body was fully flushed to the socket
 *   SERVER-ARRIVE      express saw it (same id, read from the header)
 *   SERVER-FINISH      the response finished
 *   CLIENT-RESPONSE    the client received response headers
 *   CLIENT-END         the client consumed the response body
 *   CLIENT-ERROR / SOCKET-ERROR / SOCKET-CLOSE / CLIENT-TIMEOUT
 *
 * The stall then names its own stage: a request with CLIENT-FINISH and no
 * SERVER-ARRIVE is genuinely undelivered; one with SERVER-FINISH and no
 * CLIENT-RESPONSE is a response that never came back; one with SERVER-ARRIVE and
 * no SERVER-FINISH is a handler that never answered. Those three were
 * indistinguishable before, and I guessed between them twice.
 *
 * CONTROL REQUIREMENT, because a null here is worthless on its own: every run
 * logs a deliberate warm-up request through the same path, tagged `control`. If
 * the control's lifecycle is not complete in the log, the probe is broken and
 * every absence in that file means nothing. A trace with no control is not
 * evidence.
 *
 * Opt-in via NOMAD_TEST_SOCKET_PROBE=1, no-op otherwise. It must not change what
 * it measures: it only assigns ids, adds one header, attaches listeners and
 * appends to a file. It never holds the event loop open and never throws.
 */

import http from 'node:http';
import { appendFileSync } from 'node:fs';
import type { Socket } from 'node:net';

const ENABLED = process.env.NOMAD_TEST_SOCKET_PROBE === '1';
const HEADER = 'x-nomad-probe-id';
const FILE = process.env.NOMAD_TEST_SOCKET_FILE ?? '/tmp/nomad-socket-trace.log';

let seq = 0;
const nextId = (): string => `r${++seq}-${process.pid}`;

function record(id: string, stage: string, detail = ''): void {
  try {
    appendFileSync(FILE, `${new Date().toISOString()}\t${id}\t${stage}\t${detail}\n`);
  } catch {
    // A probe that throws would fail the test it is observing.
  }
}

/** Attach the socket-level listeners for one request id. */
function watchSocket(id: string, socket: Socket): void {
  record(id, 'CLIENT-SOCKET', `connecting=${socket.connecting} remote=${socket.remotePort ?? '-'}`);
  socket.once('connect', () => record(id, 'SOCKET-CONNECT', `remote=${socket.remotePort ?? '-'}`));
  socket.once('error', (e: Error) => record(id, 'SOCKET-ERROR', e.message));
  socket.once('close', (hadError: boolean) => record(id, 'SOCKET-CLOSE', `hadError=${hadError}`));
}

if (ENABLED) {
  const origRequest = http.request.bind(http);

  // @ts-expect-error -- deliberate monkey-patch of a Node builtin, test-only.
  http.request = (...args: Parameters<typeof http.request>) => {
    const id = nextId();
    const req = origRequest(...(args as Parameters<typeof origRequest>));

    try {
      // The correlation itself. Without this the two sides cannot be joined,
      // which is exactly how the earlier stages produced a false conclusion.
      if (!req.headersSent) req.setHeader(HEADER, id);
    } catch {
      // headers already sent: still traceable client-side, just unjoinable.
      record(id, 'CLIENT-NOHEADER', 'headers already sent, cannot correlate');
    }

    record(id, 'CLIENT-CREATE', `${req.method ?? '?'} ${req.path ?? '?'}`);

    if (req.socket) watchSocket(id, req.socket as Socket);
    else req.once('socket', s => watchSocket(id, s as Socket));

    req.once('finish', () => record(id, 'CLIENT-FINISH'));
    req.once('timeout', () => record(id, 'CLIENT-TIMEOUT'));
    req.once('error', (e: Error) => record(id, 'CLIENT-ERROR', e.message));
    req.once('close', () => record(id, 'CLIENT-CLOSE'));
    req.once('response', res => {
      record(id, 'CLIENT-RESPONSE', `status=${res.statusCode}`);
      res.once('end', () => record(id, 'CLIENT-END'));
      res.once('aborted', () => record(id, 'CLIENT-RES-ABORTED'));
    });

    return req;
  };

  // Server side, keyed by the SAME id so the two halves join.
  const origCreateServer = http.createServer.bind(http);
  // @ts-expect-error -- deliberate monkey-patch of a Node builtin, test-only.
  http.createServer = (...args: Parameters<typeof http.createServer>) => {
    const server = origCreateServer(...args);
    server.on('request', (req, res) => {
      const id = (req.headers[HEADER] as string | undefined) ?? 'UNCORRELATED';
      record(id, 'SERVER-ARRIVE', `${req.method} ${req.url}`);
      res.once('finish', () => record(id, 'SERVER-FINISH', `status=${res.statusCode}`));
      res.once('close', () => {
        if (!res.writableEnded) record(id, 'SERVER-ABORT', `${req.method} ${req.url}`);
      });
    });
    server.on('connection', (s: Socket) => record('server', 'SERVER-CONNECTION', `remote=${s.remotePort ?? '-'}`));
    return server;
  };

  record('probe', 'PROBE-ARMED', `pid=${process.pid} file=${FILE}`);
}

/**
 * The control. Call once per test file, before the suite's own requests.
 *
 * Drives a complete request through the SAME patched path and asserts nothing —
 * its value is that a reader can check the control's lifecycle is complete
 * before believing any absence elsewhere in the file. If the control is
 * incomplete the instrument is deaf and the run proves nothing.
 */
export async function runProbeControl(): Promise<void> {
  if (!ENABLED) return;
  await new Promise<void>(resolve => {
    const server = http.createServer((_req, res) => {
      res.statusCode = 204;
      res.end();
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const req = http.request({ host: '127.0.0.1', port, path: '/__probe_control', method: 'GET' }, res => {
        res.resume();
        res.once('end', () => server.close(() => resolve()));
      });
      req.once('error', () => server.close(() => resolve()));
      req.end();
    });
  });
}
