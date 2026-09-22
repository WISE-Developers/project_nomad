/**
 * Tests for the temporal-step validator's weather-window rules (refs #244).
 *
 * When weather has been imported, the simulation window
 * (startDate + durationHours) must fit within the weather's dateRange.
 */

import { describe, it, expect } from 'vitest';
import { temporalValidator } from '../index.js';
import { DEFAULT_MODEL_SETUP_DATA } from '../../types/index.js';
import type { ModelSetupData } from '../../types/index.js';

function makeData(overrides: Partial<ModelSetupData['temporal']>, dateRange?: {
  minDate: string;
  maxDate: string;
}): ModelSetupData {
  return {
    ...DEFAULT_MODEL_SETUP_DATA,
    temporal: {
      // These cases are about the weather window, not the timezone. Marking
      // the zone as chosen keeps the #368 provenance rule from failing them
      // for an unrelated reason.
      timezoneSource: 'chosen',
      startDate: '2026-04-18',
      startTime: '00:00',
      durationHours: 72,
      timezone: 'UTC',
      isForecast: false,
      ...overrides,
    },
    weather: {
      ...DEFAULT_MODEL_SETUP_DATA.weather,
      source: 'raw_weather',
      ...(dateRange
        ? {
            rawWeatherParsed: {
              headers: ['Date'],
              rowCount: 1,
              previewRows: [],
              hasScenarioColumn: false,
              hasFWIColumns: false,
              dateRange,
            },
          }
        : {}),
    },
  };
}

describe('temporalValidator — weather window', () => {
  it('rejects a startDate earlier than weather minDate', () => {
    const data = makeData(
      { startDate: '2026-04-17' },
      { minDate: '2026-04-18', maxDate: '2026-04-23' },
    );

    const result = temporalValidator(data);

    expect(result.isValid).toBe(false);
    expect(
      result.errors.some((e) => /before.*weather|earlier|outside/i.test(e.message)),
    ).toBe(true);
  });

  it('rejects when the simulation end exceeds weather maxDate', () => {
    const data = makeData(
      { startDate: '2026-04-18', startTime: '00:00', durationHours: 24 * 10 },
      { minDate: '2026-04-18', maxDate: '2026-04-22' },
    );

    const result = temporalValidator(data);

    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => /past.*weather|end.*exceed|beyond/i.test(e.message))).toBe(
      true,
    );
  });

  it('accepts a window that fits inside the weather range', () => {
    const data = makeData(
      { startDate: '2026-04-18', startTime: '12:00', durationHours: 48 },
      { minDate: '2026-04-18', maxDate: '2026-04-22' },
    );

    const result = temporalValidator(data);

    expect(result.isValid).toBe(true);
  });

  it('does not enforce weather bounds when no weather has been imported', () => {
    const data = makeData({ startDate: '2030-01-01', durationHours: 24 });

    const result = temporalValidator(data);

    expect(result.isValid).toBe(true);
  });
});
