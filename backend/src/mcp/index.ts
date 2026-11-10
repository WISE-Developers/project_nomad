/**
 * MCP Server for AI-Driven Fire Modeling
 *
 * Mounts a Model Context Protocol (MCP) server on an Express app, enabling an agent
 * to create, configure, execute and interpret fire simulations.
 *
 * Transport: Streamable HTTP (MCP spec 2025-03-26), STATELESS — server and transport
 * are built per request and discarded with the response.
 *
 * WHY STATELESS.
 *
 * `sessionIdGenerator: undefined` is the line that makes it so. With no session state
 * there is no session map to keep, no lifetime to manage across requests, and no
 * per-session cleanup to get right: each request is self-contained, and authorisation
 * is therefore decided per request by the guard in `auth.ts` rather than once per
 * session. `mcpAuth.test.ts` asserts against this file's own source that it stays that
 * way.
 *
 * Mount this ONLY through `mountMcpChain` in `auth.ts`, never directly: that is where
 * the guard-then-identity ordering lives.
 *
 * @see Documentation/Nomad/design/mcp-fire-modeling-server.md
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Express, Request, Response } from 'express';
import { registerAllTools } from './tools/index.js';
import { registerAllResources } from './resources/index.js';
import type { McpToolContext } from './tools/context.js';
import { logger } from '../infrastructure/logging/index.js';

/**
 * Creates a fully configured McpServer with all tools and resources registered.
 */
function createMcpServer(context?: McpToolContext): McpServer {
  const server = new McpServer(
    { name: 'nomad-fire-modeling', version: '1.0.0' },
    {
      capabilities: {
        logging: {},
      },
    }
  );

  registerAllTools(server, context);
  registerAllResources(server);

  return server;
}

/**
 * A verb the stateless transport does not serve.
 *
 * `GET /mcp` opens an SSE stream for server-initiated notifications and `DELETE /mcp`
 * terminates a session; neither is meaningful without session state.
 *
 * They stay registered for the sake of the authorised caller. Left unregistered, a
 * valid request on either verb would fall through to a 404 and report that the endpoint
 * does not exist, when it does. A 405 says it is here and does not serve that verb,
 * which is both true and useful. Asserted in `mcpAuth.test.ts`.
 */
function methodNotAllowed(_req: Request, res: Response): void {
  res.status(405).json({
    jsonrpc: '2.0',
    error: {
      code: -32000,
      message: 'Method Not Allowed: this MCP endpoint is stateless and serves POST only',
    },
    id: null,
  });
}

/**
 * Mounts the MCP server on an Express app.
 *
 * @param app - Express application
 * @param path - Mount path (default: '/mcp')
 * @param context - identity everything MCP creates is attributed to
 */
export function mountMcpServer(
  app: Express,
  path: string = '/mcp',
  context?: McpToolContext,
): void {

  // ─── POST /mcp ─────────────────────────────────────────────────
  // Every request gets its own server and transport. `sessionIdGenerator: undefined`
  // is what makes the transport stateless — see the note at the top of this file.
  app.post(path, async (req: Request, res: Response) => {
    const server = createMcpServer(context);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    // Tie both lifetimes to the response, so a client that disconnects mid-request
    // does not leave a server and transport behind on every attempt.
    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error(
        `MCP request failed: ${error instanceof Error ? error.message : String(error)}`,
        'MCP',
      );
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal error' },
          id: null,
        });
      }
    }
  });

  // ─── GET / DELETE /mcp ─────────────────────────────────────────
  app.get(path, methodNotAllowed);
  app.delete(path, methodNotAllowed);

  logger.startup(`MCP server mounted at ${path}`);
}
