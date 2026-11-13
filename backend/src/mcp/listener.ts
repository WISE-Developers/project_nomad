/**
 * The MCP listener — its own loopback port.
 *
 * MCP is served on a dedicated loopback listener rather than as a route on the
 * application. That is deliberate and it is the design, not an optimisation.
 *
 * WHY IT IS NOT A ROUTE ON THE APPLICATION PORT.
 *
 * Where a reverse proxy or tunnel runs on the same host, it terminates at the edge and
 * forwards onward to a loopback address. The application therefore observes a loopback
 * peer address for public traffic as well as local traffic, so a peer-address check on
 * that port cannot distinguish the two. A separate port removes the question instead of
 * answering it: a port the proxy has no entry for is not reachable through the proxy,
 * so reaching it means having access to the host.
 *
 * This also requires NO change to any proxy, DNS or edge configuration, and that is the
 * requirement rather than a convenience — the design is correct precisely when it
 * leaves that configuration untouched.
 *
 * THE KEY IS THE PRIMARY CONTROL AND THE PORT IS DEPTH BEHIND IT. Which accounts on a
 * host may forward to a loopback port is a property of that host's SSH configuration,
 * not of this code, so the port is not what scopes MCP to one operator. The key does
 * that. Both are required, and they are not interchangeable.
 *
 * HOW IT IS REACHED. CORRECTED 2026-11-13, measured on the CIFFC demo at v0.59.0.
 * This block used to say "NOTHING IS PUBLISHED ... reached with an SSH forward to the
 * container's address". Both halves were unreachable in practice:
 *
 *   - A published port is forwarded by Docker to the container's BRIDGE address, never
 *     to the container's loopback. With the listener on container loopback the publish
 *     was inert: docker-proxy accepted the tunnel's bytes and closed (491 written, 0
 *     read). Measured: `172.18.0.2:3002` CLOSED while `172.18.0.2:3001` OPEN, the app
 *     being the positive control because it binds all interfaces.
 *   - An SSH forward aimed straight at the container address fails for the same reason:
 *     nothing was listening on that address either.
 *
 * So MCP is reached by publishing the port on the HOST'S loopback and binding an
 * address inside the container that the bridge can reach. Two things carry the
 * boundary, and neither is this file's loopback default:
 *
 *   1. compose pins the host side of the publish to a LITERAL 127.0.0.1, enforced by
 *      `scripts/__tests__/mcp_port_loopback_only.test.sh`, so the edge has no route --
 *      cloudflared's ingress names http://localhost:53000 and 404s everything else.
 *   2. the key, checked before anything else in `auth.ts`.
 *
 * Reaching MCP therefore still requires an account with a shell on the host PLUS the
 * key, exactly as before.
 */
import express, { type Application } from 'express';
import type { Server } from 'node:http';
import { mountMcpChain, type McpChainOptions, type McpConfig } from './auth.js';
import type { McpToolContext } from './tools/context.js';
import { logger } from '../infrastructure/logging/index.js';

/** The interface the listener binds when nothing is configured. */
const DEFAULT_MCP_BIND_ADDRESS = '127.0.0.1';

/**
 * The only addresses this listener will bind.
 *
 * An allowlist rather than a format check, because the point is not "is this a valid
 * address" but "is this one of the two deployments we have reasoned about": loopback
 * for a process reached on its own host, and all-interfaces for a container whose
 * published port is pinned to host loopback. A LAN address would be neither.
 */
const ALLOWED_MCP_BIND_ADDRESSES = ['127.0.0.1', '0.0.0.0'] as const;

/** Mirrors the default in `index.ts`, so a collision is caught when `PORT` is unset. */
const DEFAULT_MAIN_PORT = 3001;

export interface McpListenerOptions {
  readonly config: McpConfig;
  readonly port: number;
  /** Environment the bind address is read from. Defaults to `process.env`. */
  readonly env?: Record<string, string | undefined>;
  readonly toolContext: McpToolContext;
  /** Clock for the rate limiter; defaults to the real one. Injected only by tests. */
  readonly now?: () => number;
  /** Observer for refusals. Cannot change the answer a refusal gets — see auth.ts. */
  readonly onRefusal?: McpChainOptions['onRefusal'];
}

/**
 * Reads the MCP port, refusing to invent one.
 *
 * @throws when unset, unparseable, out of range, or equal to the main application port.
 *         The last matters most: sharing the application port would undo the reason
 *         this listener exists while appearing to work.
 */
export function resolveMcpPort(env: Record<string, string | undefined>): number {
  const raw = env.NOMAD_MCP_PORT?.trim();

  if (!raw) {
    throw new Error(
      'NOMAD_MCP_PORT is not set. MCP listens on its own loopback port, so the port is ' +
        'chosen rather than derived — a derived port would leave the configuration ' +
        'silent about where MCP is listening.',
    );
  }

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`NOMAD_MCP_PORT ("${raw}") is not a valid TCP port between 1 and 65535.`);
  }

  // `PORT` has a default in index.ts, so comparing only against the env var would
  // miss the collision in the common case where PORT is left unset.
  const mainPort = Number(env.PORT?.trim() || DEFAULT_MAIN_PORT);
  if (port === mainPort) {
    throw new Error(
      `NOMAD_MCP_PORT (${port}) must not be the same as the main application port ` +
        `(${mainPort}). MCP is served on a listener of its own; see mcp/listener.ts.`,
    );
  }

  return port;
}

/**
 * Reads the interface the listener binds, refusing anything it has not reasoned about.
 *
 * Unset or blank means loopback. `0.0.0.0` is permitted for the container case, where
 * Docker forwards the published host port to the bridge address and a loopback bind
 * would make the publish inert. Anything else throws rather than being coerced: a
 * silent default here would put `execute-model` and `batch-execute` on an interface
 * nobody chose, and the failure would look like success.
 *
 * @throws when the value is set to anything outside the allowlist.
 */
export function resolveMcpBindAddress(env: Record<string, string | undefined>): string {
  const raw = env.NOMAD_MCP_BIND_ADDRESS?.trim();

  if (!raw) return DEFAULT_MCP_BIND_ADDRESS;

  if (!(ALLOWED_MCP_BIND_ADDRESSES as readonly string[]).includes(raw)) {
    throw new Error(
      `NOMAD_MCP_BIND_ADDRESS ("${raw}") is not one of ${ALLOWED_MCP_BIND_ADDRESSES.join(', ')}. ` +
        'Loopback is for a listener reached on its own host; 0.0.0.0 is for a container ' +
        'whose published port is pinned to host loopback. See mcp/listener.ts.',
    );
  }

  return raw;
}

/**
 * Builds the dedicated MCP app.
 *
 * A separate `express()` rather than a route on the main app, so the application's
 * listener has no path to MCP. It carries `express.json()` and the guard chain only —
 * no API routes, no docs, no health endpoint.
 */
export function createMcpApp(options: Omit<McpListenerOptions, 'port'>): Application {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  mountMcpChain(app, {
    config: options.config,
    toolContext: options.toolContext,
    now: options.now,
    onRefusal: options.onRefusal,
  });
  return app;
}

/**
 * Starts the MCP listener on loopback.
 *
 * @returns the listening server once it is actually bound, so a caller that needs the
 *          assigned port (port 0 in tests) can read it without racing the bind.
 */
export function startMcpListener(options: McpListenerOptions): Promise<Server> {
  const app = createMcpApp({ config: options.config, toolContext: options.toolContext });

  const bindAddress = resolveMcpBindAddress(options.env ?? process.env);

  return new Promise<Server>((resolve, reject) => {
    const server = app.listen(options.port, bindAddress);
    server.once('listening', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : options.port;
      logger.startup(`MCP listening on ${bindAddress}:${port}`);
      resolve(server);
    });
    server.once('error', reject);
  });
}
