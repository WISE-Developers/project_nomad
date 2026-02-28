/**
 * MCP Knowledge Resource — Model Parameter Reference
 *
 * Provides AI agents with documentation on all valid model parameters,
 * their types, formats, and valid ranges.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

const MODEL_PARAMETERS = {
  ignition: {
    description: 'Specifies where and when fire is ignited.',
    types: {
      point: {
        description: 'Single or multiple point ignitions.',
        format: 'Array of { lat, lng, time? } objects.',
        coordinateOrder: '[lng, lat] in GeoJSON; use { lat, lng } named fields in tool calls.',
        latRange: { min: -90, max: 90, unit: 'degrees' },
        lngRange: { min: -180, max: 180, unit: 'degrees' },
        time: 'Optional ISO 8601 datetime (e.g. 2026-06-15T14:00:00Z). Defaults to simulation startTime.',
        example: [{ lat: 62.454, lng: -114.372, time: '2026-06-15T14:00:00Z' }],
      },
      polygon: {
        description: 'Area ignition defined by a polygon boundary.',
        format: 'GeoJSON Polygon geometry with [lng, lat] coordinate pairs.',
        notes: 'Polygon must be closed (first and last coordinate identical).',
      },
    },
    notes: [
      'At least one ignition point or polygon is required to execute a model.',
      'Multiple ignitions simulate simultaneous starts (e.g. lightning storm scenario).',
    ],
  },
  weather: {
    description: 'Weather conditions driving fire behavior.',
    sources: {
      raw_weather: {
        description: 'Directly specified weather values (simplest option).',
        requiredFields: {
          temperature: { unit: '°C', range: { min: -40, max: 55 } },
          relativeHumidity: { unit: '%', range: { min: 0, max: 100 } },
          windSpeed: { unit: 'km/h', range: { min: 0, max: 150 } },
          windDirection: { unit: 'degrees (meteorological, 0=N, 90=E)', range: { min: 0, max: 360 } },
        },
        optionalFields: {
          precipitation: { unit: 'mm/hour', range: { min: 0, max: 200 }, default: 0 },
          ffmc: { description: 'Fine Fuel Moisture Code override', range: { min: 0, max: 101 } },
          dmc: { description: 'Duff Moisture Code override', range: { min: 0 } },
          dc: { description: 'Drought Code override', range: { min: 0 } },
        },
      },
      firestarr_csv: {
        description: 'FireSTARR-format weather CSV file path or content.',
        format: 'CSV with columns: datetime, temp, rh, ws, wd, precip, ffmc, dmc, dc',
        notes: 'Allows time-varying weather throughout the simulation.',
      },
      spotwx: {
        description: 'SpotWx weather station data by station ID.',
        requiredFields: {
          stationId: 'SpotWx station identifier string',
        },
        notes: 'Fetches forecast weather from SpotWx API. Requires network access.',
      },
    },
  },
  timeRange: {
    description: 'Temporal bounds of the fire simulation.',
    fields: {
      startTime: {
        description: 'Simulation start datetime.',
        format: 'ISO 8601 (e.g. 2026-06-15T14:00:00Z)',
        notes: 'Should match ignition time if specified.',
      },
      endTime: {
        description: 'Simulation end datetime.',
        format: 'ISO 8601',
        notes: 'Either endTime or durationHours must be provided.',
      },
      durationHours: {
        description: 'Simulation duration as an alternative to endTime.',
        unit: 'hours',
        range: { min: 1, max: 168 },
        notes: 'Maximum 7 days (168 hours). Use endTime for precise control.',
      },
    },
  },
  simulationOptions: {
    description: 'Advanced simulation control parameters.',
    fields: {
      scenarios: {
        description: 'Number of stochastic simulation runs.',
        type: 'integer',
        range: { min: 1, max: 1000 },
        default: 100,
        notes: 'Higher values increase accuracy but extend runtime. 100 is standard operational.',
      },
      outputMode: {
        description: 'Controls what outputs are produced.',
        values: ['probability', 'perimeter', 'intensity', 'all'],
        default: 'probability',
      },
      confidenceInterval: {
        description: 'Percentile for perimeter output (used with perimeter outputMode).',
        type: 'number',
        range: { min: 0, max: 1 },
        default: 0.5,
        notes: '0.5 = median perimeter; 0.9 = 90th percentile (conservative estimate).',
      },
      smoothPerimeter: {
        description: 'Apply smoothing to output perimeters.',
        type: 'boolean',
        default: true,
      },
    },
  },
};

export function registerModelParamsResource(server: McpServer): void {
  server.registerResource(
    'model-parameters',
    'nomad://knowledge/model-parameters',
    {
      title: 'Fire Model Parameter Reference',
      description: 'Documentation of all valid fire model parameters, formats, and valid ranges.',
      mimeType: 'application/json',
    },
    async (): Promise<ReadResourceResult> => ({
      contents: [{
        uri: 'nomad://knowledge/model-parameters',
        text: JSON.stringify({
          description: 'Complete parameter reference for Project Nomad fire model configuration.',
          parameters: MODEL_PARAMETERS,
          requiredForExecution: [
            'ignition (at least one point or polygon)',
            'weather (any source)',
            'timeRange (startTime + endTime or durationHours)',
          ],
          notes: [
            'Fuel type is determined from spatial raster data at ignition location, not set as a parameter.',
            'All datetime values must be in ISO 8601 format with timezone (Z or offset).',
            'Coordinate order in GeoJSON is [longitude, latitude], but tool calls use named { lat, lng } fields.',
          ],
        }, null, 2),
        mimeType: 'application/json',
      }],
    })
  );
}
