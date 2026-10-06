/**
 * Fuel vintage vs dataset year — issue #431.
 *
 * Domain rule: the fuel layer a run uses describes the season BEFORE the dataset
 * is named for, because disturbance mapping lags the season it describes. The
 * 2026 dataset is "start-of-2026 fuels" — built from data through 2025.
 *
 *   fuel vintage = dataset year - 1
 *
 * This lives in the domain because it is a fact about fire data, not about any
 * screen or endpoint. It was previously implemented only in the frontend, which
 * meant a server-side consumer — Pack-and-Go reporting (#426), openNomad — would
 * have to re-derive it or get it wrong.
 */

import { describe, it, expect } from 'vitest';
import { fuelVintageForDatasetYear } from '../fuelYears.js';

describe('fuelVintageForDatasetYear (#431)', () => {
  it('is one year before the dataset year', () => {
    expect(fuelVintageForDatasetYear(2026)).toBe(2025);
  });

  it('never returns the dataset year itself', () => {
    const datasetYear = 2026;

    expect(fuelVintageForDatasetYear(datasetYear)).not.toBe(datasetYear);
  });

  it('holds for every vintage the demo installs', () => {
    expect(fuelVintageForDatasetYear(2023)).toBe(2022);
    expect(fuelVintageForDatasetYear(2024)).toBe(2023);
    expect(fuelVintageForDatasetYear(2025)).toBe(2024);
    expect(fuelVintageForDatasetYear(2026)).toBe(2025);
  });

  it('returns undefined rather than inferring when the dataset year is unknown', () => {
    // #331's rule: an inferred vintage is the error no reader can catch.
    expect(fuelVintageForDatasetYear(undefined)).toBeUndefined();
  });

  it('returns undefined for a non-integer dataset year', () => {
    // The "default" dataset directory carries no year of its own, and
    // Number('default') is NaN. It must not become a vintage.
    expect(fuelVintageForDatasetYear(Number.NaN)).toBeUndefined();
    expect(fuelVintageForDatasetYear(2026.5)).toBeUndefined();
  });
});
