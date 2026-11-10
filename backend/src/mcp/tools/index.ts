/**
 * MCP Tool Registration Barrel
 *
 * Registers all MCP tools on the server.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerModelTools } from './models.js';
import { registerExecutionTools } from './execution.js';
import { registerBatchTools } from './batch.js';
import type { McpToolContext } from './context.js';

/**
 * @param context - identity MCP writes are attributed to. Omitted only by callers
 *                  that deliberately create nothing owned; a configured MCP endpoint
 *                  always supplies one, enforced in `mcp/auth.ts`.
 */
export function registerAllTools(server: McpServer, context?: McpToolContext): void {
  registerModelTools(server, context);
  registerExecutionTools(server);
  registerBatchTools(server, context);
}
