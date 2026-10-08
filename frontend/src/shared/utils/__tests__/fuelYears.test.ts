/**
 * Model year vs fuel vintage, frontend side — issue #431.
 *
 * The RULE (fuel vintage = dataset year - 1) lives in the backend domain layer
 * and arrives as a field on the payload. This module READS it.
 *
 * So these tests pin a reading contract, not an arithmetic one, and the most
 * important of them is the one asserting the frontend does NOT reconstruct a
 * missing vintage from the dataset year. A second implementation of the rule is
 * how the two numbers drift apart again, and a drifted year is the error no
 * downstream reader can catch.
 */

import { describe, it, expect } from 'vitest';
import { deriveFuelYears } from '../fuelYears';
import type { ResolvedFuelDataset } from '../fuelVintage';

function resolved(over: Partial<ResolvedFuelDataset> = {}): ResolvedFuelDataset {
  // Shaped as the backend now serves it: both years named explicitly.
  return {
    requestedYear: 2026,
    datasetYear: 2026,
    fuelVintage: 2025,
    matchedRequestedYear: true,
    usedFallback: false,
    ...over,
  };
}

describe('deriveFuelYears — reads both years from the payload (#431)', () => {
  it('reports the model year and the fuel vintage the server derived', () => {
    const years = deriveFuelYears(resolved());

    expect(years.modelYear).toBe(2026);
    expect(years.datasetYear).toBe(2026);
    expect(years.fuelVintage).toBe(2025);
  });

  it('never reports the model year as the fuel vintage', () => {
    const years = deriveFuelYears(resolved());

    // The defect in one assertion.
    expect(years.fuelVintage).not.toBe(years.modelYear);
  });

  it('carries the vintage of the dataset actually used when lookup fell back', () => {
    // A 2023 fire on the 2026 dataset ran on 2025-vintage fuel. The model year
    // and the vintage are unrelated numbers here, which is the whole point.
    const years = deriveFuelYears(
      resolved({
        requestedYear: 2023,
        datasetYear: 2026,
        fuelVintage: 2025,
        matchedRequestedYear: false,
        usedFallback: true,
      })
    );

    expect(years.modelYear).toBe(2023);
    expect(years.datasetYear).toBe(2026);
    expect(years.fuelVintage).toBe(2025);
  });

  it('does NOT reconstruct a missing vintage from the dataset year', () => {
    // The guard against the rule being re-implemented here. If the server did
    // not say, the frontend does not guess — even though the arithmetic is
    // trivially available.
    const years = deriveFuelYears(
      resolved({ requestedYear: 2026, datasetYear: 2026, fuelVintage: undefined })
    );

    expect(years.datasetYear).toBe(2026);
    expect(years.fuelVintage).toBeUndefined();
  });

  it('reports no vintage when the dataset year is not recorded', () => {
    // default/ carries no year. #331's rule: say so, never infer.
    const years = deriveFuelYears(
      resolved({
        datasetYear: undefined,
        fuelVintage: undefined,
        matchedRequestedYear: false,
        usedFallback: true,
      })
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
    const expected: Array<[number, number]> = [
      [2023, 2022],
      [2024, 2023],
      [2025, 2024],
      [2026, 2025],
    ];

    for (const [modelYear, fuelVintage] of expected) {
      const years = deriveFuelYears(
        resolved({ requestedYear: modelYear, datasetYear: modelYear, fuelVintage })
      );
      expect(years.modelYear).toBe(modelYear);
      expect(years.fuelVintage).toBe(fuelVintage);
    }
  });
});
