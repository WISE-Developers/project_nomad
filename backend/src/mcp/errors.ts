/**
 * MCP Error Taxonomy
 *
 * Structured error responses for MCP tools that AI agents can reason about.
 * Every error includes a code, category, recoverability flag, and suggestion.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type ErrorCategory = 'validation' | 'state' | 'engine' | 'auth';

export interface McpToolError {
  code: string;
  category: ErrorCategory;
  message: string;
  recoverable: boolean;
  suggestion?: string;
  field?: string;
  value?: unknown;
}

/**
 * Creates a structured MCP error result that AI agents can parse and act on.
 */
export function mcpError(error: McpToolError): CallToolResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        code: error.code,
        category: error.category,
        message: error.message,
        recoverable: error.recoverable,
        ...(error.suggestion && { suggestion: error.suggestion }),
        ...(error.field && { field: error.field }),
        ...(error.value !== undefined && { value: error.value }),
      }),
    }],
    isError: true,
  };
}

// --- Validation Errors ---

export function invalidParameter(field: string, message: string, value?: unknown): CallToolResult {
  return mcpError({
    code: 'INVALID_PARAMETER',
    category: 'validation',
    field,
    value,
    message,
    recoverable: true,
    suggestion: `Fix the '${field}' parameter and retry.`,
  });
}

export function invalidFuelType(value: string): CallToolResult {
  return mcpError({
    code: 'INVALID_FUEL_TYPE',
    category: 'validation',
    field: 'fuelType',
    value,
    message: `Unknown fuel type '${value}'. Use a valid FBP fuel type code (e.g., C-2, M-1, O-1a).`,
    recoverable: true,
    suggestion: "Read the 'nomad://knowledge/fuel-types' resource for valid codes.",
  });
}

export function missingRequired(field: string): CallToolResult {
  return mcpError({
    code: 'MISSING_REQUIRED',
    category: 'validation',
    field,
    message: `Required field '${field}' is missing.`,
    recoverable: true,
    suggestion: `Provide the '${field}' parameter and retry.`,
  });
}

export function invalidCoordinates(lat: number, lng: number): CallToolResult {
  return mcpError({
    code: 'INVALID_COORDINATES',
    category: 'validation',
    field: 'coordinates',
    value: { lat, lng },
    message: `Coordinates (${lat}, ${lng}) are outside valid range. Latitude: -90 to 90, Longitude: -180 to 180.`,
    recoverable: true,
    suggestion: 'Check the coordinate values and retry.',
  });
}

export function weatherCsvInvalid(details: string): CallToolResult {
  return mcpError({
    code: 'WEATHER_CSV_INVALID',
    category: 'validation',
    field: 'firestarrCsvContent',
    message: `Weather CSV is malformed: ${details}`,
    recoverable: true,
    suggestion: 'Check the CSV format matches FireSTARR weather input requirements and retry.',
  });
}

export function weatherMissingFwi(): CallToolResult {
  return mcpError({
    code: 'WEATHER_MISSING_FWI',
    category: 'validation',
    field: 'startingCodes',
    message: "Starting FWI codes (ffmc, dmc, dc) are required when source is 'raw_weather'.",
    recoverable: true,
    suggestion: "Provide startingCodes with ffmc, dmc, and dc values, then retry.",
  });
}

// --- State Errors ---

export function modelNotFound(modelId: string): CallToolResult {
  return mcpError({
    code: 'MODEL_NOT_FOUND',
    category: 'state',
    message: `Model '${modelId}' not found.`,
    recoverable: true,
    suggestion: "Use 'list-models' to see available models.",
  });
}

export function jobNotFound(jobId: string): CallToolResult {
  return mcpError({
    code: 'JOB_NOT_FOUND',
    category: 'state',
    message: `Job '${jobId}' not found.`,
    recoverable: true,
    suggestion: "Check the model's jobs or use 'list-models' to find the right model.",
  });
}

export function modelNotReady(modelId: string, missing: string[]): CallToolResult {
  const toolSuggestions = missing
    .filter(m => m !== 'fuel-type') // fuel comes from raster, no user tool needed
    .map(m => `set-${m}`)
    .join(', ');
  return mcpError({
    code: 'MODEL_NOT_READY',
    category: 'state',
    message: `Model '${modelId}' is missing required configuration: ${missing.join(', ')}.`,
    recoverable: true,
    suggestion: toolSuggestions
      ? `Set the missing parameters using: ${toolSuggestions}.`
      : 'Set the missing parameters using the appropriate tools.',
  });
}

export function modelAlreadyRunning(modelId: string): CallToolResult {
  return mcpError({
    code: 'MODEL_ALREADY_RUNNING',
    category: 'state',
    message: `Model '${modelId}' already has an active execution.`,
    recoverable: true,
    suggestion: "Wait for the current execution to complete, or cancel it first.",
  });
}

// --- Engine Errors ---

export function engineUnavailable(engine: string): CallToolResult {
  return mcpError({
    code: 'ENGINE_UNAVAILABLE',
    category: 'engine',
    message: `Engine '${engine}' is not available on this server.`,
    recoverable: false,
    suggestion: 'Check server configuration or try a different engine.',
  });
}

export function engineFailed(message: string): CallToolResult {
  return mcpError({
    code: 'ENGINE_FAILED',
    category: 'engine',
    message,
    recoverable: false,
    suggestion: 'Check the engine logs or contact an administrator.',
  });
}
