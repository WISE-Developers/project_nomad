/**
 * MCP Knowledge Resources Barrel
 *
 * Registers all static knowledge resources on the MCP server.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerFuelTypesResource } from './fuel-types.js';
import { registerFwiSystemResource } from './fwi-system.js';
import { registerModelParamsResource } from './model-params.js';

export function registerKnowledgeResources(server: McpServer): void {
  registerFuelTypesResource(server);
  registerFwiSystemResource(server);
  registerModelParamsResource(server);
}
