/**
 * MCP Tool Registration Barrel
 *
 * Registers all MCP tools on the server.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerModelTools } from './models.js';
import { registerExecutionTools } from './execution.js';

export function registerAllTools(server: McpServer): void {
  registerModelTools(server);
  registerExecutionTools(server);
}
