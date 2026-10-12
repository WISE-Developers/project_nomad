/**
 * The single construction of ExecutionOptions.
 *
 * WHY THIS EXISTS. There were four independent constructions of the same type,
 * and they had already diverged:
 *
 *   - `POST /models/run`        derived outputMode from `modelMode`
 *   - `POST /models/:id/execute` derived it from `body.outputMode`, ignoring
 *                                `modelMode` entirely (issue #435)
 *   - MCP `execute-model`        derived nothing — the fields were absent
 *   - `prometheus/toExecutionOptions.ts` — a fourth, with no production caller
 *
 * WHY A NEW INPUT TYPE RATHER THAN AN ANNOTATION. Every parity-relevant field on
 * `ExecutionOptions` is optional (`simulationCount?`, `outputMode?`, …), so a
 * four-field object literal already satisfies it. Annotating the MCP literal
 * `: ExecutionOptions` compiles clean and catches nothing. **The optionality is
 * the defect's habitat.** `ExecutionRequest` below closes it: every field is a
 * REQUIRED KEY, and the ones that may legitimately be absent are typed
 * `| undefined` so a caller must write the key and state the absence. You cannot
 * forget a field you are obliged to mention.
 *
 * That is the mechanism behind "this project should maintain that": parity is a
 * compile error, not a discipline. A new option added here cannot reach the
 * engine from one caller and not another.
 */
import type { TimeRange } from '../../domain/value-objects/index.js';
import type { SpatialGeometry } from '../../domain/entities/index.js';
import type { WeatherConfig } from '../../infrastructure/weather/types.js';
import type {
  ExecutionOptions,
  ModelMode,
  OutputMode,
} from '../interfaces/IFireModelingEngine.js';

/**
 * Everything a caller must state in order to execute a model.
 *
 * Every key is required. `undefined` is how a caller says "not specified" — it
 * is not how a caller says nothing at all.
 */
export interface ExecutionRequest {
  readonly ignitionGeometry: SpatialGeometry;
  readonly timeRange: TimeRange;
  /** IANA identifier. No default is invented — an empty value throws. */
  readonly timezone: string;
  readonly weatherConfig: WeatherConfig | undefined;
  /** Absent means the probabilistic default, stated once, here. */
  readonly modelMode: ModelMode | undefined;
  /** Absent means the count implied by the mode — 100 probabilistic, 1 deterministic. */
  readonly scenarios: number | undefined;
}

/** Probabilistic unless explicitly deterministic. Not a fall-through. */
export function deriveOutputMode(modelMode: ModelMode | undefined): OutputMode {
  return modelMode === 'deterministic' ? 'deterministic' : 'probabilistic';
}

/**
 * The simulation count the GUI would have sent for this mode
 * (`frontend/src/App.tsx:314`): 100 probabilistic, 1 otherwise.
 *
 * An explicit count from the caller always wins. Overriding a number someone
 * typed would be the same class of fault as dropping `modelMode`.
 */
function resolveSimulationCount(
  scenarios: number | undefined,
  modelMode: ModelMode | undefined,
): number {
  if (scenarios !== undefined) return scenarios;
  return modelMode === 'deterministic' ? 1 : 100;
}

export function buildExecutionOptions(request: ExecutionRequest): ExecutionOptions {
  if (typeof request.timezone !== 'string' || request.timezone.length === 0) {
    throw new Error(
      'buildExecutionOptions: timezone is required and has no default. ' +
        'Pass an IANA identifier (e.g. "America/Edmonton").',
    );
  }

  return {
    ignitionGeometry: request.ignitionGeometry,
    timeRange: request.timeRange,
    timezone: request.timezone,
    weatherConfig: request.weatherConfig,
    outputMode: deriveOutputMode(request.modelMode),
    simulationCount: resolveSimulationCount(request.scenarios, request.modelMode),
    // Hardcoded by the engine as of #146 and ignored from caller input during
    // normal execution. Stated here so all callers agree rather than each
    // repeating the constants.
    confidenceInterval: 1,
    smoothPerimeter: false,
  };
}
