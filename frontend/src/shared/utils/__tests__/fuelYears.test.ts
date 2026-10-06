/**
 * Model year vs fuel vintage — issue #431.
 *
 * NOMAD has been displaying the MODEL YEAR under the label "fuel vintage".
 * They differ by one: the fuel layer a run uses is built from the PREVIOUS
 * season, because disturbance mapping lags the season it describes. There are
 * no 2026 fuels until the 2026 season has happened.
 *
 * The dataset directories, the installer, and `dataset.json` all key on the
 * model year (the index calls 2026 "start-of-2026 fuels; input for 2026 model
 * runs"). That convention is kept — these tests do not change what is stored.
 * They pin the DERIVED pair that gets displayed.
 *
 *   fuel vintage = (dataset year actually used) - 1
 *
 * Deriving from the dataset ACTUALLY USED rather than from the requested model
 * year is the case that matters: fuel lookup falls back, so a 2023 model can
 * run on the 2026 dataset. The vintage must describe the fuel that ran, not
 * the fuel that was asked for.
 */

import { describe, it, expect } from 'vitest';
import { deriveFuelYears } from '../fuelYears';
import type { ResolvedFuelDataset } from '../fuelVintage';

function resolved(over: Partial<ResolvedFuelDataset> = {}): ResolvedFuelDataset {
  return {
    requestedYear: 2026,
    vintage: 2026,
    matchedRequestedYear: true,
    usedFallback: false,
    ...over,
  };
}

describe('deriveFuelYears — model year and fuel vintage are distinct (#431)', () => {
  it('derives the fuel vintage as one year before the dataset used', () => {
    const years = deriveFuelYears(resolved({ requestedYear: 2026, vintage: 2026 }));

    expect(years.modelYear).toBe(2026);
    expect(years.datasetYear).toBe(2026);
    expect(years.fuelVintage).toBe(2025);
  });

  it('never reports the model year as the fuel vintage', () => {
    const years = deriveFuelYears(resolved({ requestedYear: 2026, vintage: 2026 }));

    // The whole defect in one assertion: these two must not be the same number.
    expect(years.fuelVintage).not.toBe(years.modelYear);
  });

  it('derives the vintage from the dataset ACTUALLY USED, not the requested year', () => {
    // A 2023 fire that fell back to the 2026 dataset ran on 2025-vintage fuel.
    // Deriving from the model year would claim 2022 — fuel that never touched
    // this run.
    const years = deriveFuelYears(
      resolved({
        requestedYear: 2023,
        vintage: 2026,
        matchedRequestedYear: false,
        usedFallback: true,
      })
    );

    expect(years.modelYear).toBe(2023);
    expect(years.datasetYear).toBe(2026);
    expect(years.fuelVintage).toBe(2025);
    expect(years.fuelVintage).not.toBe(2022);
  });

  it('reports the vintage as undefined when the dataset year is not recorded', () => {
    // default/ carries no vintage of its own. #331's rule: say "not recorded",
    // never infer. An inferred vintage is the error no reader can catch.
    const years = deriveFuelYears(
      resolved({ requestedYear: 2026, vintage: undefined, matchedRequestedYear: false, usedFallback: true })
    );

    expect(years.modelYear).toBe(2026);
    expect(years.datasetYear).toBeUndefined();
    expect(years.fuelVintage).toBeUndefined();
  });

  it('reports nothing when resolution is unavailable', () => {
    const years = deriveFuelYears(undefined);

    expect(years.modelYear).toBeUndefined();
    expect(years.datasetYear).toBeUndefined();
    expect(years.fuelVintage).toBeUndefined();
  });

  it('holds across every vintage the demo installs', () => {
    // Model years 2023-2026 are installed; the fuel vintages are 2022-2025.
    const expected: Array<[number, number]> = [
      [2023, 2022],
      [2024, 2023],
      [2025, 2024],
      [2026, 2025],
    ];

    for (const [modelYear, fuelVintage] of expected) {
      const years = deriveFuelYears(resolved({ requestedYear: modelYear, vintage: modelYear }));
      expect(years.fuelVintage).toBe(fuelVintage);
    }
  });
});
