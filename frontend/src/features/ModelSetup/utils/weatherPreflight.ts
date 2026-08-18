/**
 * Wizard-side pre-flight helpers — issue #351.
 *
 * A FireSTARR-format CSV carrying CFFDRS values on daily rows only satisfies
 * neither supported weather contract. Uploaded as firestarr_csv it parses to
 * NaN on every other row, and those NaNs reach the FireSTARR command line and
 * segfault the engine. The user already has the starting codes — they are in
 * the file — so we find them and offer them rather than guessing or refusing.
 *
 * These live in features/ModelSetup/ on purpose. DashboardContainer and
 * ModelSetupWizard never call runModel themselves; they forward to a
 * host-supplied onComplete. App.tsx is only the SAN reference implementation,
 * so a check built there would protect SAN and leave every ACN integrator with
 * the same NaN and the same segfault.
 *
 * Pure functions only — no React, no fetch. That is what makes the submit gate
 * testable, since no harness exists for that path.
 */

import type { ModelSetupData, TemporalData, WeatherData } from '../types/index.js';

/** The reading recovered by the backend, as it arrives over JSON. */
export interface StartingCodeCandidate {
  ffmc: number;
  dmc: number;
  dc: number;
  /** ISO instant the reading was taken. */
  observedAt: string;
  /** Human-facing local label, e.g. "2026-08-03, 1900". */
  localLabel: string;
}

export interface PreflightResult {
  dailyOnlyCffdrs: boolean;
  candidate: StartingCodeCandidate | null;
}

/**
 * Only an uploaded FireSTARR CSV can have the daily-only shape. raw_weather
 * already carries explicit starting codes, and spotwx is generated rather than
 * uploaded, so neither is worth a round-trip.
 */
export function needsPreflight(weather: WeatherData): boolean {
  return weather.source === 'firestarr_csv' && weather.firestarrCsvFile !== undefined;
}

/**
 * The ignition instant, built exactly as App.tsx:189 builds timeRange.start.
 *
 * That line parses a naive date-time string, which JavaScript reads in the
 * BROWSER's zone rather than the model's declared timezone — filed as #355.
 * This reproduces the bug deliberately: the pre-flight answer depends on which
 * daily reading precedes ignition, so if the gate computed a more correct
 * instant than the run that follows it, the codes offered could disagree with
 * the codes the model actually needed. One consistent error beats two
 * inconsistent ones. When #355 is fixed, both move together.
 */
export function buildIgnitionInstant(temporal: TemporalData): string {
  return new Date(`${temporal.startDate}T${temporal.startTime}`).toISOString();
}

/**
 * Rewrites the weather config onto the raw_weather path, carrying the codes
 * recovered from the user's own file.
 *
 * The same File is reused — the user uploaded it once and should not be asked
 * again. The firestarr_csv fields are cleared so no stale second source is left
 * for a later step to pick up.
 *
 * Returns a new object; the wizard's state is never mutated in place.
 */
export function applyStartingCodes(
  data: ModelSetupData,
  candidate: StartingCodeCandidate,
): ModelSetupData {
  const {
    firestarrCsvFile,
    firestarrCsvFileName,
    firestarrCsvParsed: _dropped,
    ...rest
  } = data.weather;

  return {
    ...data,
    weather: {
      ...rest,
      source: 'raw_weather',
      rawWeatherFile: firestarrCsvFile,
      rawWeatherFileName: firestarrCsvFileName,
      startingCodes: {
        ffmc: candidate.ffmc,
        dmc: candidate.dmc,
        dc: candidate.dc,
      },
    },
  };
}

/**
 * Reads an uploaded file to text.
 *
 * FileReader rather than File.text(): it is what the rest of the codebase uses
 * (App.tsx:193-200, and each of the upload components), and File.text() is not
 * implemented in jsdom, which would leave the submit gate untestable.
 */
export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
    reader.readAsText(file);
  });
}
