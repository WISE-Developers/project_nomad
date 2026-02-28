/**
 * MCP Resource Registration Barrel
 *
 * Registers all MCP resources on the server.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDynamicResources } from './dynamic.js';
import { registerKnowledgeResources } from './knowledge/index.js';

export function registerAllResources(server: McpServer): void {
  registerDynamicResources(server);
  registerKnowledgeResources(server);
}
