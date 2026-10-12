/**
 * Convention test — the MCP surface may not drift from the execution contract.
 *
 * Franco's ruling, 2026-10-11: "you need to model in mcp same as via GUI and this
 * project should maintain that." Closing the gaps was the easy half. THIS is the
 * second half: a mechanism, so parity does not depend on anyone remembering.
 *
 * HOW IT WORKS. `ExecutionRequest` (buildExecutionOptions.ts) is the one place
 * that states everything a caller must supply to run a model. Every field on it
 * must be accounted for by the MCP server in exactly one of two ways:
 *
 *   1. exposed as a parameter of the `execute-model` tool, or
 *   2. sourced from stored config written by an earlier `set-*` tool.
 *
 * Adding a field to `ExecutionRequest` and classifying it in neither place fails
 * this test. That is the whole mechanism: a new option cannot reach the engine
 * from the GUI while being unreachable from MCP without someone deciding, in
 * writing, which bucket it belongs in.
 *
 * WHY IT READS THE SOURCE rather than a list maintained here. A hand-kept list
 * drifts for precisely the reason this codebase drifted — somebody has to
 * remember. The repo already uses this shape in
 * `src/shared/__tests__/noBareNewDate.convention.test.ts`.
 *
 * WHY NOT A NAME-LEVEL CHECK. Asserting that a field's NAME appears somewhere in
 * the MCP source passes against the broken state: `weatherConfig` appears in the
 * old four-field literal, which was exactly the bug. The check below requires the
 * field to be a declared schema key or an explicitly classified config field.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const APP_EXECUTION = join(__dirname, '..');
const MCP_TOOLS = join(__dirname, '..', '..', '..', 'mcp', 'tools');

const builderSource = readFileSync(join(APP_EXECUTION, 'buildExecutionOptions.ts'), 'utf8');
const executionToolSource = readFileSync(join(MCP_TOOLS, 'execution.ts'), 'utf8');

/** Field names declared on `interface ExecutionRequest`, read from the source. */
function executionRequestFields(source: string): string[] {
  const match = source.match(/export interface ExecutionRequest \{([\s\S]*?)\n\}/);
  if (!match) throw new Error('ExecutionRequest interface not found — this test cannot run');

  return match[1]
    .split('\n')
    .map((line) => line.replace(/\/\*.*?\*\//g, '').trim())
    .filter((line) => line && !line.startsWith('*') && !line.startsWith('//') && !line.startsWith('/*'))
    .map((line) => line.match(/^readonly\s+([A-Za-z0-9_]+)\s*[?:]/)?.[1])
    .filter((name): name is string => Boolean(name));
}

/** Parameter names on the `execute-model` tool's inputSchema, read from the source. */
function executeModelSchemaKeys(source: string): string[] {
  const toolStart = source.indexOf("'execute-model'");
  if (toolStart < 0) throw new Error("execute-model tool not found — this test cannot run");

  const schemaStart = source.indexOf('inputSchema: {', toolStart);
  if (schemaStart < 0) throw new Error('execute-model inputSchema not found');

  const body = source.slice(schemaStart, source.indexOf('async (', schemaStart));
  return Array.from(body.matchAll(/^\s{6,8}([A-Za-z0-9_]+):\s*z\s*$|^\s{6,8}([A-Za-z0-9_]+):\s*z\./gm))
    .map((m) => m[1] ?? m[2])
    .filter((name): name is string => Boolean(name));
}

/**
 * Fields NOT passed as execute-model parameters because an earlier tool already
 * collected them into stored config. Each entry names the tool responsible.
 *
 * This is the one hand-maintained list in the file, and it is deliberately a
 * CLASSIFICATION rather than a copy: a new ExecutionRequest field is not silently
 * covered by it — someone must add it here with the tool that supplies it, or
 * expose it on execute-model. Both are decisions; neither is forgetting.
 */
const SOURCED_FROM_STORED_CONFIG: Record<string, string> = {
  ignitionGeometry: 'set-ignition',
  timeRange: 'set-simulation-time',
  timezone: 'set-simulation-time',
  weatherConfig: 'set-weather',
};

describe('MCP/GUI execution parity convention', () => {
  describe('the controls: this test can fail, and can pass', () => {
    it('actually parses ExecutionRequest — a silent empty read would pass everything', () => {
      const fields = executionRequestFields(builderSource);
      expect(fields.length).toBeGreaterThan(0);
      expect(fields).toContain('ignitionGeometry');
      expect(fields).toContain('modelMode');
    });

    it('actually parses the execute-model schema', () => {
      const keys = executeModelSchemaKeys(executionToolSource);
      expect(keys.length).toBeGreaterThan(0);
      expect(keys).toContain('modelId');
    });

    it('goes RED against a field classified in neither place', () => {
      // The known positive. A guard that has never been seen to fail is an
      // unknown guard — and a guard that only ever fails is equally useless, so
      // the two assertions above prove the green direction.
      const withNewField = builderSource.replace(
        'export interface ExecutionRequest {',
        'export interface ExecutionRequest {\n  readonly fuelVintage: number | undefined;',
      );
      const unaccounted = executionRequestFields(withNewField).filter(
        (field) =>
          !executeModelSchemaKeys(executionToolSource).includes(field) &&
          !(field in SOURCED_FROM_STORED_CONFIG),
      );
      expect(unaccounted).toEqual(['fuelVintage']);
    });
  });

  it('accounts for every ExecutionRequest field in the MCP surface', () => {
    const fields = executionRequestFields(builderSource);
    const schemaKeys = executeModelSchemaKeys(executionToolSource);

    const unaccounted = fields.filter(
      (field) => !schemaKeys.includes(field) && !(field in SOURCED_FROM_STORED_CONFIG),
    );

    expect(
      unaccounted,
      `These ExecutionRequest fields are reachable from the GUI but not from MCP: ` +
        `${unaccounted.join(', ')}.\n` +
        `Either expose each on the execute-model tool, or add it to ` +
        `SOURCED_FROM_STORED_CONFIG naming the set-* tool that supplies it.`,
    ).toEqual([]);
  });

  it('does not claim a config-sourced field without naming a real tool', () => {
    // A classification pointing at a tool that does not exist is a lie that
    // passes. Check each named tool is actually registered.
    const modelsToolSource = readFileSync(join(MCP_TOOLS, 'models.ts'), 'utf8');
    const allToolSource = modelsToolSource + executionToolSource;

    for (const [field, tool] of Object.entries(SOURCED_FROM_STORED_CONFIG)) {
      expect(
        allToolSource.includes(`'${tool}'`),
        `${field} is classified as supplied by '${tool}', but no such MCP tool is registered`,
      ).toBe(true);
    }
  });

  it('keeps line ignition reachable from MCP, as the GUI already emits it', () => {
    const modelsToolSource = readFileSync(join(MCP_TOOLS, 'models.ts'), 'utf8');
    expect(modelsToolSource).toMatch(/z\s*\.?\s*enum\(\[[^\]]*'linestring'[^\]]*\]\)/);
  });
});
