/**
 * #536, condition 5 — an MCP caller that has NEVER triggered a GUI read must
 * still see the perimeter and arrival-time rows.
 *
 * #536 persists these products as result rows at the point they are derived,
 * inside ModelResultsService.getResults(). That alone is not enough: MCP's
 * `get-results-summary` and `get-results-data` read the result repository
 * directly, so with persistence happening only on the GUI's reader, an MCP-only
 * caller would see perimeters ONLY AFTER a human had opened that model in a
 * browser.
 *
 * That would be a worse bug than the one being fixed — it would present as
 * intermittent, and the variable would be a person's browsing, which is invisible
 * from the MCP side. So the MCP tools must trigger the same derive-and-persist,
 * and these tests pin that they do.
 *
 * The mocked service below records whether it was asked, and only then does the
 * repository hold the rows — so a tool that skips the trigger returns the old
 * three-probability-row answer and fails here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  FireModel,
  createFireModelId,
  ModelStatus,
  ModelResult,
  createModelResultId,
  OutputType,
  OutputFormat,
  EngineType,
} from '../../../domain/entities/index.js';

const MODEL_ID = '20cd8b4e-b4b3-4ff6-b126-0baa299b933e';

/** Rows the repository holds. Starts with probability only — the #536 symptom. */
let rows: ModelResult[] = [];
/** Set when the application service is asked to produce results. */
let deriveCalls = 0;

function probabilityRow(julianDay: number): ModelResult {
  return new ModelResult({
    id: createModelResultId(`prob-${julianDay}-${MODEL_ID}`),
    fireModelId: createFireModelId(MODEL_ID),
    outputType: OutputType.Probability,
    format: OutputFormat.GeoTIFF,
    metadata: { filePath: `${MODEL_ID}/probability_${julianDay}_2025-07-30.tif`, julianDay },
  });
}

function perimeterRow(julianDay: number): ModelResult {
  return new ModelResult({
    id: createModelResultId(`perimeter-day${julianDay}-${MODEL_ID}`),
    fireModelId: createFireModelId(MODEL_ID),
    outputType: OutputType.Perimeter,
    format: OutputFormat.GeoJSON,
    metadata: {
      julianDay,
      deterministic: true,
      geojson: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [] } },
    },
  });
}

function arrivalRow(): ModelResult {
  return new ModelResult({
    id: createModelResultId(`arrival-time-${MODEL_ID}`),
    fireModelId: createFireModelId(MODEL_ID),
    outputType: OutputType.ArrivalTime,
    format: OutputFormat.GeoTIFF,
    metadata: { filePath: `${MODEL_ID}/000_000001_213_arrival.tif`, deterministic: true },
  });
}

vi.mock('../../../infrastructure/database/index.js', () => ({
  getResultRepository: () => ({
    save: vi.fn(async () => {}),
    findByModelId: vi.fn(async () => rows),
  }),
  getModelRepository: () => ({
    findById: vi.fn(async (id: string) =>
      id === MODEL_ID
        ? new FireModel({
            id: createFireModelId(MODEL_ID),
            name: 'SS014-25 hindcast',
            status: ModelStatus.Completed,
            // Required by FireModelProps — tsc caught its absence here.
            engineType: EngineType.FireSTARR,
          })
        : null,
    ),
    getConfigJson: vi.fn(async () => null),
  }),
}));

// Asking the application service for results is what derives and persists the
// deterministic products (#536). Here that is simulated by adding the rows.
vi.mock('../../../application/services/index.js', () => ({
  getModelResultsService: vi.fn(() => ({
    getResults: vi.fn(async () => {
      deriveCalls += 1;
      if (!rows.some((r) => r.outputType === OutputType.Perimeter)) {
        rows = [...rows, perimeterRow(211), perimeterRow(212), arrivalRow()];
      }
      return { success: true, value: { outputs: [] } };
    }),
  })),
}));

vi.mock('../../../infrastructure/engines/index.js', () => ({
  getEngine: () => ({ getResults: vi.fn(async () => []) }),
}));

vi.mock('../../../infrastructure/services/JobQueue.js', () => ({
  getJobQueue: () => ({ enqueue: vi.fn(), getJob: vi.fn() }),
}));

import { registerExecutionTools } from '../../tools/execution.js';

async function connectedClient() {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerExecutionTools(server);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function parse(result: unknown): Record<string, unknown> {
  const content = (result as { content: Array<{ text: string }> }).content;
  return JSON.parse(content[0].text) as Record<string, unknown>;
}

beforeEach(() => {
  rows = [probabilityRow(211), probabilityRow(212), probabilityRow(213)];
  deriveCalls = 0;
});

describe('#536 condition 5 — MCP sees the derived rows with no GUI read', () => {
  it('get-results-data returns the perimeter and arrival_time rows', async () => {
    const client = await connectedClient();

    const parsed = parse(
      await client.callTool({ name: 'get-results-data', arguments: { modelId: MODEL_ID } }),
    );

    const results = parsed.results as Array<{ outputType: string }>;
    const types = [...new Set(results.map((r) => r.outputType))].sort();

    // Before #536 this was exactly ['probability'] — the issue's own evidence.
    expect(types).toEqual(['arrival_time', 'perimeter', 'probability']);
    expect(deriveCalls).toBeGreaterThan(0);
  });

  it('get-results-summary counts them in outputTypes', async () => {
    const client = await connectedClient();

    const parsed = parse(
      await client.callTool({ name: 'get-results-summary', arguments: { modelId: MODEL_ID } }),
    );

    expect((parsed.outputTypes as string[]).sort()).toEqual([
      'arrival_time',
      'perimeter',
      'probability',
    ]);
    // The issue observed resultCount 3; the perimeters and arrival raster are 3 more.
    expect(parsed.resultCount).toBe(6);
  });

  it('THE DISCRIMINATOR: a perimeter row reaches the caller WITH its geometry', async () => {
    // A row that merely exists with the right outputType would still leave an
    // MCP caller unable to use the perimeter — the same failure one layer in.
    const client = await connectedClient();

    const parsed = parse(
      await client.callTool({ name: 'get-results-data', arguments: { modelId: MODEL_ID } }),
    );

    const results = parsed.results as Array<{
      outputType: string;
      metadata?: { geojson?: { geometry?: { type?: string } } };
    }>;
    const perimeter = results.find((r) => r.outputType === 'perimeter');

    expect(perimeter, 'a perimeter row should be returned').toBeDefined();
    expect(perimeter!.metadata?.geojson?.geometry?.type).toBe('Polygon');
  });

  it('does not fail the read when deriving throws', async () => {
    // The products are an additional view. A derivation that cannot run must
    // leave the probability rows reachable rather than taking the tool down.
    const { getModelResultsService } = await import('../../../application/services/index.js');
    vi.mocked(getModelResultsService).mockReturnValueOnce({
      getResults: vi.fn(async () => {
        throw new Error('GDAL unavailable');
      }),
    } as unknown as ReturnType<typeof getModelResultsService>);

    const client = await connectedClient();

    const parsed = parse(
      await client.callTool({ name: 'get-results-data', arguments: { modelId: MODEL_ID } }),
    );

    const results = parsed.results as Array<{ outputType: string }>;
    expect(results.length).toBe(3);
    expect(results.every((r) => r.outputType === 'probability')).toBe(true);
  });
});
