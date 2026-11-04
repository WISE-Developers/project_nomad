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
 * NOTHING IS PUBLISHED. There is deliberately no `ports:` entry for this in compose:
 * the listener binds inside the container and is reached with an SSH forward to the
 * container's address. Nothing is exposed on the host and the edge has no route to it.
 * The honest cost is that the container address is not stable across recreates, so the
 * forward target is looked up each time rather than written down.
 */
import express, { type Application } from 'express';
import type { Server } from 'node:http';
import { mountMcpChain, type McpChainOptions, type McpConfig } from './auth.js';
import type { McpToolContext } from './tools/context.js';
import { logger } from '../infrastructure/logging/index.js';

/**
 * The interface the listener binds.
 *
 * Loopback, and hardcoded rather than configurable. Serving MCP on another interface
 * would be a deliberate change of the design above, so it requires editing this file.
 */
const MCP_BIND_ADDRESS = '127.0.0.1';

/** Mirrors the default in `index.ts`, so a collision is caught when `PORT` is unset. */
const DEFAULT_MAIN_PORT = 3001;

export interface McpListenerOptions {
  readonly config: McpConfig;
  readonly port: number;
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

  return new Promise<Server>((resolve, reject) => {
    const server = app.listen(options.port, MCP_BIND_ADDRESS);
    server.once('listening', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : options.port;
      logger.startup(`MCP listening on ${MCP_BIND_ADDRESS}:${port} (not published)`);
      resolve(server);
    });
    server.once('error', reject);
  });
}
