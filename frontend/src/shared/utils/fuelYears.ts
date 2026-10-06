/**
 * Model year vs fuel vintage — issue #431.
 *
 * NOMAD displayed the model year under the label "fuel vintage". They differ by
 * one year, and the difference is not cosmetic: the fuel layer a run uses is
 * built from the PREVIOUS season, because disturbance mapping lags the season it
 * describes. There are no 2026 fuels until the 2026 season has happened.
 *
 *   fuel vintage = (dataset year actually used) - 1
 *
 * The STORED convention is unchanged and remains correct for what it names: the
 * dataset index, the installer, the directory names and `dataset.json` all key
 * on the model year — the index calls the 2026 dataset "start-of-2026 fuels;
 * input for 2026 model runs". Nothing persisted is rewritten by this module, so
 * no completed run's record changes meaning (the failure #331 closed).
 *
 * This is the ONE place the relationship lives. Every display derives from here
 * rather than re-deriving, so the two numbers cannot drift apart again.
 *
 * Derived from the dataset ACTUALLY USED, not the requested model year, because
 * fuel lookup falls back: a 2023 model can run on the 2026 dataset, which is
 * 2025-vintage fuel. Deriving from the model year would report 2022 — fuel that
 * never touched the run. The vintage must describe the fuel that ran.
 */

import type { ResolvedFuelDataset } from './fuelVintage';

export interface FuelYears {
  /** The year being modelled. */
  readonly modelYear?: number;
  /** The dataset directory year actually used. */
  readonly datasetYear?: number;
  /** The vintage of the fuel data itself: datasetYear - 1. */
  readonly fuelVintage?: number;
}

export function deriveFuelYears(resolved: ResolvedFuelDataset | undefined): FuelYears {
  if (!resolved) {
    return {};
  }

  const { requestedYear, vintage } = resolved;

  // No dataset year recorded (e.g. default/ carries no vintage of its own).
  // Report nothing rather than inferring one — #331's rule. An inferred vintage
  // is the error no downstream reader can catch.
  if (!Number.isInteger(vintage)) {
    return { modelYear: requestedYear, datasetYear: undefined, fuelVintage: undefined };
  }

  return {
    modelYear: requestedYear,
    datasetYear: vintage,
    fuelVintage: (vintage as number) - 1,
  };
}
