/**
 * MCP Server for AI-Driven Fire Modeling
 *
 * Mounts a Model Context Protocol (MCP) server on the existing Express app,
 * enabling AI agents to create, configure, execute, and interpret fire simulations.
 *
 * Transport: Streamable HTTP (MCP spec 2025-03-26)
 * Session: Stateful — one transport per client session, managed via session map.
 *
 * @see Documentation/Nomad/design/mcp-fire-modeling-server.md
 */
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Express, Request, Response } from 'express';
import { registerAllTools } from './tools/index.js';
import { registerAllResources } from './resources/index.js';
import { logger } from '../infrastructure/logging/index.js';

/** Active transport sessions indexed by session ID */
const transports = new Map<string, StreamableHTTPServerTransport>();

/**
 * Creates a fully configured McpServer with all tools and resources registered.
 */
function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'nomad-fire-modeling', version: '1.0.0' },
    {
      capabilities: {
        logging: {},
      },
    }
  );

  registerAllTools(server);
  registerAllResources(server);

  return server;
}

/**
 * Mounts the MCP server on an Express app.
 *
 * Registers POST, GET, and DELETE handlers at the given path.
 * Must be called after middleware setup but before error handlers.
 *
 * @param app - Express application
 * @param path - Mount path (default: '/mcp')
 */
export function mountMcpServer(app: Express, path: string = '/mcp'): void {

  // ─── POST /mcp ─────────────────────────────────────────────────
  // Handles: session initialization (initialize request) and all subsequent JSON-RPC messages
  app.post(path, async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    // Route to existing session
    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // New session — must be an initialize request
    if (!sessionId && isInitializeRequest(req.body)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid: string) => {
          transports.set(sid, transport);
          logger.info(`MCP session started: ${sid}`, 'MCP');
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          transports.delete(transport.sessionId);
          logger.info(`MCP session closed: ${transport.sessionId}`, 'MCP');
        }
      };

      const server = createMcpServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // Invalid request
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Bad Request: missing or invalid session' },
      id: null,
    });
  });

  // ─── GET /mcp ──────────────────────────────────────────────────
  // Opens SSE stream for server-initiated notifications (progress, resource changes)
  app.get(path, async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Invalid or missing session ID' },
        id: null,
      });
      return;
    }

    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  });

  // ─── DELETE /mcp ───────────────────────────────────────────────
  // Terminates a session
  app.delete(path, async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Invalid or missing session ID' },
        id: null,
      });
      return;
    }

    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  });

  logger.startup(`MCP server mounted at ${path}`);
}

/**
 * Returns count of active MCP sessions. Useful for health checks.
 */
export function getActiveSessionCount(): number {
  return transports.size;
}
