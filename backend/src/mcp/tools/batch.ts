/**
 * MCP Tools — Batch and Comparison (#167 phase 4)
 *
 * Deliberately a composition layer over capability NOMAD already has: clone
 * reads and rewrites `config_json`, `batch-execute` drives the SAME path as
 * `execute-model` via `submitModelForExecution`, and `compare-models` reads
 * models and their result rows.
 *
 * Nothing here reaches for a capability that does not exist. The phase-5
 * spatial queries that did are #508, where `ISpatialRepository` is recorded as
 * a declaration with no implementation.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpToolContext } from './context.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { v4 as uuidv4 } from 'uuid';
import {
  FireModel,
  createFireModelId,
  ModelStatus,
} from '../../domain/entities/index.js';
import { getModelRepository } from '../../infrastructure/database/index.js';
import { modelNotFound, invalidParameter } from '../errors.js';
import { submitModelForExecution } from './execution.js';

/** Upper bound on one batch. A cap stated here beats an unbounded loop. */
const MAX_BATCH = 25;

/**
 * Reads the error code out of a tool result that reported a failure.
 *
 * `submitModelForExecution` answers in `CallToolResult`, so a batch row has to
 * interpret that rather than re-deriving the failure. Returning a literal
 * fallback rather than `undefined` matters: a row with no code would read as a
 * success with a missing job, which is the silent-default lie.
 */
function errorCodeOf(result: CallToolResult): string {
  const content = result.content as Array<{ type: string; text?: string }> | undefined;
  const text = content?.[0]?.text;
  if (!text) return 'UNKNOWN_ERROR';
  try {
    const parsed = JSON.parse(text) as { code?: string };
    return parsed.code ?? 'UNKNOWN_ERROR';
  } catch {
    return 'UNKNOWN_ERROR';
  }
}

/** Reads the job id out of a successful execution result. */
function jobIdOf(result: CallToolResult): string | undefined {
  const content = result.content as Array<{ type: string; text?: string }> | undefined;
  const text = content?.[0]?.text;
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as { jobId?: string };
    return parsed.jobId;
  } catch {
    return undefined;
  }
}

/**
 * Registers the batch and comparison tools on the MCP server.
 */
export function registerBatchTools(server: McpServer, context?: McpToolContext): void {

  // ─── clone-model ───────────────────────────────────────────────
  server.registerTool(
    'clone-model',
    {
      title: 'Clone Fire Model',
      description:
        'Copy an existing model into a new draft carrying the same configuration. ' +
        'The source model is not modified. Use this to vary one parameter across runs.',
      inputSchema: {
        modelId: z.string().describe('Model ID to clone'),
        name: z.string().min(1).max(200).optional()
          .describe("Name for the clone. Defaults to 'Copy of <source name>'."),
      },
    },
    async ({ modelId, name }): Promise<CallToolResult> => {
      const repo = getModelRepository();
      const source = await repo.findById(createFireModelId(modelId));
      if (!source) return modelNotFound(modelId);

      const cloneId = createFireModelId(uuidv4());
      const cloneName = name ?? `Copy of ${source.name}`;

      // A clone always starts as a draft, whatever the source's status is.
      // Copying a `completed` status would describe results the clone has not
      // produced.
      const clone = new FireModel({
        id: cloneId,
        name: cloneName,
        engineType: source.engineType,
        status: ModelStatus.Draft,
        // The MCP caller made this record, so the clone is attributed to them rather
        // than inheriting the source's owner. Second of the two creation sites in the
        // MCP tools — the other is create-model in models.ts.
        userId: context?.userId,
      });
      await repo.save(clone);

      // The configuration is copied by value. Writing the source's object
      // through would leave two models sharing one config, so a later edit of
      // the clone would silently rewrite the original.
      const sourceConfig = await repo.getConfigJson(createFireModelId(modelId));
      if (sourceConfig) {
        await repo.saveConfigJson(
          cloneId,
          JSON.parse(JSON.stringify(sourceConfig)) as Record<string, unknown>,
        );
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            modelId: cloneId,
            sourceModelId: modelId,
            name: clone.name,
            engine: clone.engineType,
            status: clone.status,
            configCopied: sourceConfig !== null,
            message: sourceConfig
              ? `Model '${source.name}' cloned as '${cloneName}'. The clone carries the source configuration and can be executed or edited independently.`
              : `Model '${source.name}' cloned as '${cloneName}'. The source had no configuration to copy, so the clone needs set-ignition, set-weather and set-simulation-time before it can run.`,
          }, null, 2),
        }],
      };
    }
  );

  // ─── batch-execute ─────────────────────────────────────────────
  server.registerTool(
    'batch-execute',
    {
      title: 'Execute Fire Models in Batch',
      description:
        'Submit several configured models for execution in one call. Each model is ' +
        'submitted through the same path as execute-model. A model that cannot be ' +
        'submitted is reported individually and does not stop the others.',
      inputSchema: {
        modelIds: z.array(z.string()).min(1).max(MAX_BATCH)
          .describe(`Model IDs to execute (1-${MAX_BATCH})`),
        modelMode: z.enum(['probabilistic', 'deterministic']).optional()
          .describe('Model mode applied to every model in the batch. Defaults to probabilistic.'),
        scenarios: z.number().int().positive().optional()
          .describe('Number of simulations applied to every model in the batch.'),
      },
    },
    async ({ modelIds, modelMode, scenarios }): Promise<CallToolResult> => {
      const rows: Array<Record<string, unknown>> = [];

      // Sequential on purpose. Each submission starts engine work, so firing
      // twenty-five at once would contend for the same executor; the job queue
      // is what provides concurrency, not this loop.
      for (const id of modelIds) {
        const result = await submitModelForExecution({ modelId: id, modelMode, scenarios });

        if (result.isError) {
          rows.push({ modelId: id, error: errorCodeOf(result) });
          continue;
        }

        const jobId = jobIdOf(result);
        if (!jobId) {
          // Reported success without a job id. Recording this as a failure
          // rather than an empty success: a row with no job is not a run.
          rows.push({ modelId: id, error: 'NO_JOB_RETURNED' });
          continue;
        }
        rows.push({ modelId: id, jobId, status: 'queued' });
      }

      const submitted = rows.filter(r => r.jobId !== undefined).length;
      const failed = rows.length - submitted;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            submitted,
            failed,
            results: rows,
            message: failed === 0
              ? `${submitted} model(s) submitted. Use get-job-status on each job ID to track progress.`
              : `${submitted} model(s) submitted, ${failed} could not be submitted. Every failure is named in results.`,
          }, null, 2),
        }],
      };
    }
  );

  // ─── compare-models ────────────────────────────────────────────
  server.registerTool(
    'compare-models',
    {
      title: 'Compare Fire Models',
      description:
        'Return a side-by-side summary of two or more models: name, status, engine and ' +
        'how many result artifacts each has. A model that cannot be read is named in ' +
        'the comparison rather than omitted from it.',
      inputSchema: {
        modelIds: z.array(z.string()).min(1).max(MAX_BATCH)
          .describe(`Model IDs to compare (2-${MAX_BATCH})`),
      },
    },
    async ({ modelIds }): Promise<CallToolResult> => {
      // Enforced here rather than by `.min(2)` on the schema so the refusal
      // arrives as a structured MCP error an agent can act on, instead of a
      // transport-level schema rejection.
      if (modelIds.length < 2) {
        return invalidParameter(
          'modelIds',
          `A comparison needs at least 2 models; ${modelIds.length} given. ` +
            'Use get-results-summary for a single model.',
          modelIds.length,
        );
      }

      const repo = getModelRepository();
      const rows: Array<Record<string, unknown>> = [];

      for (const id of modelIds) {
        const model = await repo.findById(createFireModelId(id));
        if (!model) {
          // Named, not dropped. A comparison that silently returns fewer rows
          // than it was asked for is a false answer rather than a missing one.
          rows.push({ modelId: id, error: 'MODEL_NOT_FOUND' });
          continue;
        }

        const results = await repo.getResults(createFireModelId(id));
        rows.push({
          modelId: id,
          name: model.name,
          engine: model.engineType,
          status: model.status,
          resultCount: results.length,
        });
      }

      const readable = rows.filter(r => r.error === undefined).length;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            models: rows,
            compared: readable,
            unreadable: rows.length - readable,
            message: readable === rows.length
              ? `Compared ${readable} models.`
              : `Compared ${readable} of ${rows.length} requested models; the rest are named with an error in models.`,
          }, null, 2),
        }],
      };
    }
  );
}
