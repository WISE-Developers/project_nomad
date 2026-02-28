/**
 * MCP Tools — Model Configuration
 *
 * Tools for creating and configuring fire models via MCP.
 * Configuration is persisted to the database via config_json.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { v4 as uuidv4 } from 'uuid';
import {
  FireModel,
  createFireModelId,
  EngineType,
  ModelStatus,
  SpatialGeometry,
  GeometryType,
} from '../../domain/entities/index.js';
import { getModelRepository } from '../../infrastructure/database/index.js';
import {
  modelNotFound,
  invalidCoordinates,
  invalidParameter,
  weatherMissingFwi,
} from '../errors.js';

/**
 * Registers all model configuration tools on the MCP server.
 */
export function registerModelTools(server: McpServer): void {

  // ─── list-models ───────────────────────────────────────────────
  server.registerTool(
    'list-models',
    {
      title: 'List Fire Models',
      description: 'List existing fire models. Optionally filter by status.',
      inputSchema: {
        status: z.enum(['draft', 'queued', 'running', 'completed', 'failed']).optional()
          .describe('Filter by model status'),
        limit: z.number().int().min(1).max(100).optional().default(20)
          .describe('Maximum number of models to return (default: 20)'),
      },
    },
    async ({ status, limit }): Promise<CallToolResult> => {
      const repo = getModelRepository();
      const filter = status ? { status: status as ModelStatus } : {};
      const result = await repo.find(filter, { limit, sortBy: 'createdAt', sortOrder: 'desc' });

      const models = await Promise.all(result.models.map(async m => {
        const config = await repo.getConfigJson(createFireModelId(m.id));
        const configuredSections = config ? Object.keys(config) : [];
        return {
          id: m.id,
          name: m.name,
          status: m.status,
          createdAt: m.createdAt.toISOString(),
          configuredSections,
        };
      }));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ models, totalCount: result.totalCount }, null, 2),
        }],
      };
    }
  );

  // ─── create-model ──────────────────────────────────────────────
  server.registerTool(
    'create-model',
    {
      title: 'Create Fire Model',
      description: 'Create a new fire model. Returns the model ID for use with configuration tools.',
      inputSchema: {
        name: z.string().min(1).max(200)
          .describe('Name for the fire model (e.g., "Highway 3 Fire - Wind Scenario A")'),
        description: z.string().max(1000).optional()
          .describe('Optional description of the model scenario'),
      },
    },
    async ({ name }): Promise<CallToolResult> => {
      const repo = getModelRepository();
      const modelId = createFireModelId(uuidv4());

      const model = new FireModel({
        id: modelId,
        name,
        engineType: EngineType.FireSTARR,
        status: ModelStatus.Draft,
      });

      await repo.save(model);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            modelId,
            name: model.name,
            engine: model.engineType,
            status: model.status,
            message: `Model '${name}' created. Configure it with set-ignition, set-weather, and set-simulation-time before executing.`,
          }, null, 2),
        }],
      };
    }
  );

  // ─── set-ignition ──────────────────────────────────────────────
  server.registerTool(
    'set-ignition',
    {
      title: 'Set Ignition Geometry',
      description: 'Set ignition point or polygon for a fire model. FireSTARR reads fuel from the raster grid at this location.',
      inputSchema: {
        modelId: z.string().describe('Model ID from create-model'),
        type: z.enum(['point', 'polygon']).describe("Ignition geometry type: 'point' or 'polygon'"),
        coordinates: z.union([
          z.tuple([z.number(), z.number()]),
          z.array(z.tuple([z.number(), z.number()])),
        ]).describe("For point: [lon, lat]. For polygon: array of [lon, lat] pairs forming a closed ring."),
      },
    },
    async ({ modelId, type, coordinates }): Promise<CallToolResult> => {
      const repo = getModelRepository();
      const model = await repo.findById(createFireModelId(modelId));
      if (!model) return modelNotFound(modelId);

      // Build and validate via SpatialGeometry (throws on invalid input)
      let geometry: SpatialGeometry;
      try {
        if (type === 'point') {
          const [lon, lat] = coordinates as [number, number];
          geometry = new SpatialGeometry({
            type: GeometryType.Point,
            coordinates: [lon, lat],
          });
        } else {
          // polygon — wrap coordinates array in a ring array
          const ring = coordinates as [number, number][];
          geometry = new SpatialGeometry({
            type: GeometryType.Polygon,
            coordinates: [ring],
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (type === 'point') {
          const [lon, lat] = coordinates as [number, number];
          return invalidCoordinates(lat, lon);
        }
        return invalidParameter('coordinates', msg, coordinates);
      }

      // Persist to config_json
      const existingConfig = await repo.getConfigJson(createFireModelId(modelId)) ?? {};
      await repo.saveConfigJson(createFireModelId(modelId), {
        ...existingConfig,
        ignition: { type, coordinates: geometry.coordinates },
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            modelId,
            ignition: { type, coordinates: geometry.coordinates },
            message: `Set ${type} ignition for model '${model.name}'.`,
          }, null, 2),
        }],
      };
    }
  );

  // ─── set-weather ───────────────────────────────────────────────
  server.registerTool(
    'set-weather',
    {
      title: 'Set Weather Configuration',
      description: "Set weather data source for a fire model. Supports 'firestarr_csv', 'raw_weather', or 'spotwx'.",
      inputSchema: {
        modelId: z.string().describe('Model ID from create-model'),
        source: z.enum(['firestarr_csv', 'raw_weather', 'spotwx'])
          .describe("Weather data source"),
        firestarrCsvContent: z.string().optional()
          .describe("FireSTARR-ready CSV content (required when source is 'firestarr_csv')"),
        rawWeatherContent: z.string().optional()
          .describe("Raw weather CSV content without FWI columns (required when source is 'raw_weather')"),
        startingCodes: z.object({
          ffmc: z.number().describe('Fine Fuel Moisture Code (0-101)'),
          dmc: z.number().describe('Duff Moisture Code (0+)'),
          dc: z.number().describe('Drought Code (0+)'),
        }).optional()
          .describe("FWI starting codes (required when source is 'raw_weather')"),
        latitude: z.number().min(-90).max(90).optional()
          .describe('Latitude for CFFDRS calculation (used with raw_weather)'),
      },
    },
    async ({ modelId, source, firestarrCsvContent, rawWeatherContent, startingCodes, latitude }): Promise<CallToolResult> => {
      const repo = getModelRepository();
      const model = await repo.findById(createFireModelId(modelId));
      if (!model) return modelNotFound(modelId);

      // Validate source-specific requirements
      if (source === 'firestarr_csv' && !firestarrCsvContent) {
        return invalidParameter('firestarrCsvContent', "firestarrCsvContent is required when source is 'firestarr_csv'.");
      }
      if (source === 'raw_weather') {
        if (!rawWeatherContent) {
          return invalidParameter('rawWeatherContent', "rawWeatherContent is required when source is 'raw_weather'.");
        }
        if (!startingCodes) {
          return weatherMissingFwi();
        }
      }

      const weatherConfig: Record<string, unknown> = { source };
      if (firestarrCsvContent) weatherConfig.firestarrCsvContent = firestarrCsvContent;
      if (rawWeatherContent) weatherConfig.rawWeatherContent = rawWeatherContent;
      if (startingCodes) weatherConfig.startingCodes = startingCodes;
      if (latitude !== undefined) weatherConfig.latitude = latitude;

      // Persist to config_json
      const existingConfig = await repo.getConfigJson(createFireModelId(modelId)) ?? {};
      await repo.saveConfigJson(createFireModelId(modelId), {
        ...existingConfig,
        weather: weatherConfig,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            modelId,
            weather: { source },
            message: `Weather set for model '${model.name}' using source '${source}'.`,
          }, null, 2),
        }],
      };
    }
  );

  // ─── set-simulation-time ───────────────────────────────────────
  server.registerTool(
    'set-simulation-time',
    {
      title: 'Set Simulation Time',
      description: 'Set the start and end time for a fire model simulation.',
      inputSchema: {
        modelId: z.string().describe('Model ID from create-model'),
        startTime: z.string()
          .describe('Simulation start time (ISO 8601, e.g., "2026-06-15T14:00:00Z")'),
        endTime: z.string()
          .describe('Simulation end time (ISO 8601, e.g., "2026-06-15T20:00:00Z")'),
      },
    },
    async ({ modelId, startTime, endTime }): Promise<CallToolResult> => {
      const repo = getModelRepository();
      const model = await repo.findById(createFireModelId(modelId));
      if (!model) return modelNotFound(modelId);

      // Validate both dates
      const parsedStart = new Date(startTime);
      if (isNaN(parsedStart.getTime())) {
        return invalidParameter('startTime', `'${startTime}' is not a valid ISO 8601 date.`, startTime);
      }

      const parsedEnd = new Date(endTime);
      if (isNaN(parsedEnd.getTime())) {
        return invalidParameter('endTime', `'${endTime}' is not a valid ISO 8601 date.`, endTime);
      }

      if (parsedEnd <= parsedStart) {
        return invalidParameter('endTime', `endTime must be after startTime. Got startTime=${startTime}, endTime=${endTime}.`, endTime);
      }

      const timeRange = { start: startTime, end: endTime };

      // Persist to config_json
      const existingConfig = await repo.getConfigJson(createFireModelId(modelId)) ?? {};
      await repo.saveConfigJson(createFireModelId(modelId), {
        ...existingConfig,
        timeRange,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            modelId,
            timeRange,
            message: `Simulation time set for model '${model.name}': ${startTime} to ${endTime}.`,
          }, null, 2),
        }],
      };
    }
  );
}
