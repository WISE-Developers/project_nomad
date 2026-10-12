/**
 * buildExecutionOptions — the single derivation of ExecutionOptions.
 *
 * Before this module there were FOUR independent constructions of the same type:
 *   - api/routes/v1/models.ts:259-268   (POST /models/run,        from `modelMode`)
 *   - api/routes/v1/models.ts:670-679   (POST /models/:id/execute, from `body.outputMode`)
 *   - mcp/tools/execution.ts:101-106    (untyped; omitted the fields entirely)
 *   - application/prometheus/toExecutionOptions.ts:95 (no production caller)
 *
 * Every parity-relevant field on ExecutionOptions is optional, so none of those
 * omissions was a compile error. The optionality was the defect's habitat —
 * which is why the fix is a REQUIRED input type here, and not an annotation there.
 */
import { describe, it, expect } from 'vitest';
import { buildExecutionOptions } from '../buildExecutionOptions.js';
import { SpatialGeometry, GeometryType } from '../../../domain/entities/index.js';
import { TimeRange } from '../../../domain/value-objects/index.js';
import type { WeatherConfig } from '../../../infrastructure/weather/types.js';

const geometry = new SpatialGeometry({
  type: GeometryType.Point,
  coordinates: [-114.3, 62.5],
});
const timeRange = TimeRange.fromISO('2026-06-15T14:00:00Z', '2026-06-15T20:00:00Z');
const weatherConfig = { source: 'firestarr_csv' } as unknown as WeatherConfig;

function base() {
  return {
    ignitionGeometry: geometry,
    timeRange,
    timezone: 'America/Edmonton',
    weatherConfig,
    modelMode: undefined,
    scenarios: undefined,
  };
}

describe('buildExecutionOptions', () => {
  describe('outputMode — one derivation, replacing four', () => {
    it('derives deterministic from modelMode', () => {
      expect(buildExecutionOptions({ ...base(), modelMode: 'deterministic' }).outputMode).toBe(
        'deterministic',
      );
    });

    it('derives probabilistic from modelMode', () => {
      expect(buildExecutionOptions({ ...base(), modelMode: 'probabilistic' }).outputMode).toBe(
        'probabilistic',
      );
    });

    it('defaults to probabilistic when no mode is given', () => {
      expect(buildExecutionOptions(base()).outputMode).toBe('probabilistic');
    });

    it('does not treat long-term-risk as deterministic', () => {
      // The third mode exists in the type and is not yet available. It must not
      // fall into the deterministic branch by accident — that is the missing-else
      // shape this whole change is about.
      expect(buildExecutionOptions({ ...base(), modelMode: 'long-term-risk' }).outputMode).toBe(
        'probabilistic',
      );
    });
  });

  describe('simulationCount — matching what the GUI sends', () => {
    it('uses 100 for a probabilistic run, as App.tsx:314 does', () => {
      expect(
        buildExecutionOptions({ ...base(), modelMode: 'probabilistic' }).simulationCount,
      ).toBe(100);
    });

    it('uses 1 for a deterministic run, as App.tsx:314 does', () => {
      // Deterministic is a single simulation (scenario 000001). The old HTTP
      // default of `scenarios ?? 100` gave a deterministic run 100 simulations
      // whenever the caller omitted the field — which the GUI never did, so it
      // was only ever reachable by API clients.
      expect(
        buildExecutionOptions({ ...base(), modelMode: 'deterministic' }).simulationCount,
      ).toBe(1);
    });

    it('honours an explicit scenario count over the default', () => {
      expect(buildExecutionOptions({ ...base(), scenarios: 25 }).simulationCount).toBe(25);
    });

    it('honours an explicit count even when it contradicts the mode', () => {
      // Caller intent wins over the convention. Silently overriding a number the
      // caller typed would be the same class of fault as dropping modelMode.
      expect(
        buildExecutionOptions({ ...base(), modelMode: 'deterministic', scenarios: 7 })
          .simulationCount,
      ).toBe(7);
    });
  });

  describe('required fields pass through unchanged', () => {
    it('carries ignitionGeometry, timeRange, timezone and weatherConfig', () => {
      const options = buildExecutionOptions(base());
      expect(options.ignitionGeometry).toBe(geometry);
      expect(options.timeRange).toBe(timeRange);
      expect(options.timezone).toBe('America/Edmonton');
      expect(options.weatherConfig).toBe(weatherConfig);
    });

    it('fails fast on a missing timezone rather than substituting one', () => {
      // The interface comment on ExecutionOptions.timezone says "Required — no
      // silent default." A builder that invented one would move the lie inward.
      expect(() => buildExecutionOptions({ ...base(), timezone: '' })).toThrow(/timezone/i);
    });
  });

  describe('engine-hardcoded fields (#146)', () => {
    it('sets confidenceInterval and smoothPerimeter to what the engine forces', () => {
      const options = buildExecutionOptions(base());
      expect(options.confidenceInterval).toBe(1);
      expect(options.smoothPerimeter).toBe(false);
    });
  });
});
