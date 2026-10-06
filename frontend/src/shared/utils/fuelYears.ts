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
 * The RULE itself lives server-side, in the backend domain layer
 * (domain/value-objects/fuelYears.ts), and reaches the frontend as a field on
 * the payload. This module READS it; it does not compute it.
 *
 * That split is deliberate. Pack-and-Go reporting (#426) and openNomad consumers
 * are served by the same backend, so a rule implemented here would have to be
 * re-implemented there — and the first copy to drift produces a confidently
 * wrong year that no downstream reader can catch.
 *
 * The vintage is of the dataset ACTUALLY USED, not of the requested model year,
 * because fuel lookup falls back: a 2023 model can run on the 2026 dataset,
 * which is 2025-vintage fuel. The vintage must describe the fuel that ran.
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

  const { requestedYear, datasetYear, fuelVintage } = resolved;

  // Nothing is inferred here. A missing vintage reports as missing — #331's
  // rule — and a vintage the server did not supply is NOT reconstructed from
  // the dataset year, because a second implementation of the rule is how the
  // two numbers drift apart again.
  return {
    modelYear: requestedYear,
    datasetYear: Number.isInteger(datasetYear) ? datasetYear : undefined,
    fuelVintage: Number.isInteger(fuelVintage) ? fuelVintage : undefined,
  };
}
