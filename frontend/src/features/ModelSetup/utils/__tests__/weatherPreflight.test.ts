/**
 * Wizard-side pre-flight helpers — issue #351.
 *
 * Pure functions only. The wizard calls these around the network round-trip;
 * keeping them free of React and fetch is what makes the submit gate testable
 * at all, since no harness exists for that path.
 */

import { describe, it, expect } from 'vitest';
import {
  buildIgnitionInstant,
  needsPreflight,
  applyStartingCodes,
  type StartingCodeCandidate,
} from '../weatherPreflight.js';
import type { ModelSetupData } from '../../types/index.js';

const CANDIDATE: StartingCodeCandidate = {
  ffmc: 84.65,
  dmc: 20.72,
  dc: 424.9,
  observedAt: '2026-08-04T01:06:00.000Z',
  localLabel: '2026-08-03, 1900',
};

function csvFile(name = 'station.csv'): File {
  return new File(['Scenario,Date\n0,2026-08-01 00:06:00'], name, { type: 'text/csv' });
}

function baseData(overrides: Partial<ModelSetupData> = {}): ModelSetupData {
  return {
    geometry: {} as ModelSetupData['geometry'],
    temporal: {
      startDate: '2026-08-04',
      startTime: '12:00',
      durationHours: 72,
      timezone: 'America/Edmonton',
      isForecast: false,
    },
    model: {} as ModelSetupData['model'],
    weather: {
      source: 'firestarr_csv',
      firestarrCsvFile: csvFile(),
      firestarrCsvFileName: 'station.csv',
    },
    ...overrides,
  } as ModelSetupData;
}

describe('needsPreflight', () => {
  it('is true for an uploaded FireSTARR CSV — the only shape that can be daily-only', () => {
    expect(needsPreflight(baseData().weather)).toBe(true);
  });

  it('is false for raw_weather, which already carries explicit starting codes', () => {
    expect(needsPreflight({ source: 'raw_weather', rawWeatherFile: csvFile() })).toBe(false);
  });

  it('is false for spotwx, which is generated rather than uploaded', () => {
    expect(needsPreflight({ source: 'spotwx', spotwxFile: csvFile() })).toBe(false);
  });

  it('is false when no file has actually been attached', () => {
    expect(needsPreflight({ source: 'firestarr_csv' })).toBe(false);
  });
});

describe('buildIgnitionInstant', () => {
  it('produces an ISO string carrying an explicit offset', () => {
    // The backend rejects bare timestamps that name no offset, so this must
    // never hand back something like "2026-08-04T12:00".
    const iso = buildIgnitionInstant(baseData().temporal);
    expect(iso).toMatch(/Z$|[+-]\d{2}:\d{2}$/);
  });

  it('matches what App.tsx sends as timeRange.start, byte for byte', () => {
    // Deliberate: App.tsx:189 parses this naive string in the BROWSER zone,
    // which is wrong (#355). The gate reproduces that exactly so the reading
    // it offers cannot disagree with the run that follows. When #355 is fixed,
    // both move together and this test is what proves it.
    const { startDate, startTime } = baseData().temporal;
    const appTsx = new Date(`${startDate}T${startTime}`).toISOString();
    expect(buildIgnitionInstant(baseData().temporal)).toBe(appTsx);
  });
});

describe('applyStartingCodes', () => {
  it('switches the file to the raw_weather path carrying the recovered codes', () => {
    const applied = applyStartingCodes(baseData(), CANDIDATE);

    expect(applied.weather.source).toBe('raw_weather');
    expect(applied.weather.startingCodes).toEqual({ ffmc: 84.65, dmc: 20.72, dc: 424.9 });
  });

  it('carries the very same file across — the user uploaded it once', () => {
    const data = baseData();
    const applied = applyStartingCodes(data, CANDIDATE);

    expect(applied.weather.rawWeatherFile).toBe(data.weather.firestarrCsvFile);
    expect(applied.weather.rawWeatherFileName).toBe('station.csv');
  });

  it('clears the firestarr_csv fields so no stale second source is left behind', () => {
    const applied = applyStartingCodes(baseData(), CANDIDATE);

    expect(applied.weather.firestarrCsvFile).toBeUndefined();
    expect(applied.weather.firestarrCsvFileName).toBeUndefined();
  });

  it('does not mutate the wizard state it was handed', () => {
    const data = baseData();
    applyStartingCodes(data, CANDIDATE);

    expect(data.weather.source).toBe('firestarr_csv');
    expect(data.weather.startingCodes).toBeUndefined();
  });

  it('leaves every other part of the setup untouched', () => {
    const data = baseData();
    const applied = applyStartingCodes(data, CANDIDATE);

    expect(applied.temporal).toEqual(data.temporal);
    expect(applied.geometry).toBe(data.geometry);
    expect(applied.model).toBe(data.model);
  });
});
