/**
 * Tests for TemporalStep.
 *
 * Weather-first wizard: the start-date picker defaults to the first datetime
 * in the imported weather data, falling back to today when no weather is
 * available yet (refs #238).
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TemporalStep } from './TemporalStep.js';
import { WizardProvider } from '../../Wizard/index.js';
import type { WizardConfig } from '../../Wizard/index.js';
import type { ModelSetupData } from '../types/index.js';
import { DEFAULT_MODEL_SETUP_DATA, MODEL_SETUP_STEPS } from '../types/index.js';

function createWizardWrapper(initialData: ModelSetupData = DEFAULT_MODEL_SETUP_DATA) {
  const config: WizardConfig<ModelSetupData> = {
    steps: MODEL_SETUP_STEPS as unknown as WizardConfig<ModelSetupData>['steps'],
    initialData,
    storageKey: 'test-temporal-step',
    validators: {},
    onComplete: vi.fn(),
    onCancel: vi.fn(),
  };

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <WizardProvider config={config}>{children}</WizardProvider>;
  };
}

describe('TemporalStep default start date', () => {
  it('defaults to the minDate from parsed weather data when available', () => {
    const initialData: ModelSetupData = {
      ...DEFAULT_MODEL_SETUP_DATA,
      weather: {
        ...DEFAULT_MODEL_SETUP_DATA.weather,
        source: 'firestarr_csv',
        firestarrCsvParsed: {
          headers: ['Date', 'Hour', 'FFMC', 'DMC', 'DC', 'ISI', 'BUI', 'FWI'],
          rowCount: 2,
          previewRows: [],
          hasScenarioColumn: false,
          hasFWIColumns: true,
          dateRange: { minDate: '2025-07-15', maxDate: '2025-07-17' },
        },
      },
    };
    const Wrapper = createWizardWrapper(initialData);

    render(
      <Wrapper>
        <TemporalStep />
      </Wrapper>,
    );

    const dateInput = screen.getByLabelText('Start date') as HTMLInputElement;
    expect(dateInput.value).toBe('2025-07-15');
  });

  it('falls back to today when no parsed weather data is available', () => {
    const Wrapper = createWizardWrapper();

    render(
      <Wrapper>
        <TemporalStep />
      </Wrapper>,
    );

    const dateInput = screen.getByLabelText('Start date') as HTMLInputElement;
    const today = new Date().toISOString().slice(0, 10);
    expect(dateInput.value).toBe(today);
  });

  it('clamps an existing startDate into the new weather range when it falls outside', () => {
    const initialData: ModelSetupData = {
      ...DEFAULT_MODEL_SETUP_DATA,
      temporal: {
        startDate: '2026-05-30',
        startTime: '12:00',
        durationHours: 72,
        timezone: 'UTC',
        isForecast: false,
      },
      weather: {
        ...DEFAULT_MODEL_SETUP_DATA.weather,
        source: 'raw_weather',
        rawWeatherParsed: {
          headers: ['Date'],
          rowCount: 2,
          previewRows: [],
          hasScenarioColumn: false,
          hasFWIColumns: false,
          dateRange: { minDate: '2026-04-18', maxDate: '2026-04-22' },
        },
      },
    };
    const Wrapper = createWizardWrapper(initialData);

    render(
      <Wrapper>
        <TemporalStep />
      </Wrapper>,
    );

    const dateInput = screen.getByLabelText('Start date') as HTMLInputElement;
    expect(dateInput.value).toBe('2026-04-18');
  });

  it('bounds the start-date input to the weather dateRange (min/max)', () => {
    const initialData: ModelSetupData = {
      ...DEFAULT_MODEL_SETUP_DATA,
      weather: {
        ...DEFAULT_MODEL_SETUP_DATA.weather,
        source: 'raw_weather',
        rawWeatherParsed: {
          headers: ['Date'],
          rowCount: 2,
          previewRows: [],
          hasScenarioColumn: false,
          hasFWIColumns: false,
          dateRange: { minDate: '2026-04-18', maxDate: '2026-04-22' },
        },
      },
    };
    const Wrapper = createWizardWrapper(initialData);

    render(
      <Wrapper>
        <TemporalStep />
      </Wrapper>,
    );

    const dateInput = screen.getByLabelText('Start date') as HTMLInputElement;
    expect(dateInput.min).toBe('2026-04-18');
    expect(dateInput.max).toBe('2026-04-22');
  });
});

/**
 * Zone-correctness of the "model ends at" preview — issue #367.
 *
 * The preview is built from the start date, start time and duration. Doing
 * that with `new Date("YYYY-MM-DDTHH:mm")` reads the string in the BROWSER's
 * zone and formats the result there too, so the model's own timezone never
 * reaches the calculation. This is the bug class #355 fixed elsewhere via
 * resolveZonedInstant; this helper was missed.
 *
 * The two mistakes cancel for most inputs, which is why it survived: wall
 * clock plus duration comes out the same in either zone when both zones sit
 * at a constant offset across the window. They stop cancelling when a DST
 * transition falls inside the window in one zone and not the other -- so
 * that is the case asserted here.
 *
 * Window: 2026-03-07 12:00 in America/Edmonton, running 48 hours. Edmonton
 * springs forward on 2026-03-08, so 48 real hours advance the local clock by
 * 49. The model therefore ends at 13:00 local, not 12:00.
 *
 * These tests run with TZ=UTC (see the npm script), which has no transition
 * in that window -- exactly the mismatch that exposes the defect.
 */
describe('TemporalStep end-time preview (#367)', () => {
  const dstCrossing: ModelSetupData = {
    ...DEFAULT_MODEL_SETUP_DATA,
    temporal: {
      ...DEFAULT_MODEL_SETUP_DATA.temporal,
      startDate: '2026-03-07',
      startTime: '12:00',
      durationHours: 48,
      timezone: 'America/Edmonton',
    },
  };

  it("honours the model's timezone across a DST transition, not the browser's", () => {
    const Wrapper = createWizardWrapper(dstCrossing);
    render(<TemporalStep />, { wrapper: Wrapper });

    // 2026-03-07 12:00 MST is 19:00Z. Plus 48h is 2026-03-09 19:00Z, which
    // is 13:00 in Edmonton because the zone moved to MDT on the 8th.
    expect(screen.getByText(/13:00/)).toBeTruthy();
  });

  it('labels the preview with a timezone so the reader cannot misread it', () => {
    const Wrapper = createWizardWrapper(dstCrossing);
    render(<TemporalStep />, { wrapper: Wrapper });

    // A bare time on a model that carries an explicit zone is ambiguous:
    // the operator cannot tell whether they are reading fire-local time or
    // their own. Every other zone-aware surface in this codebase emits a
    // zone name alongside the value.
    expect(screen.getByText(/MDT|MST|GMT[+-]\d/)).toBeTruthy();
  });
});
