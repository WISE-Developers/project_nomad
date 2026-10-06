/**
 * Describes the fuel dataset vintage a model run uses, and whether that is
 * worth warning about (#319).
 *
 * Fuel datasets are installed one per vintage year; lookup prefers {year}/ and
 * silently falls back to default/. Without this, a 2019 fire could be modelled
 * on 2026 fuel with nothing on screen to say so.
 *
 * Everything here is NON-BLOCKING by design. Running an old fire against newer
 * fuel is legitimate — reconstructions, what-ifs, and comparisons all do it.
 * The point is that it should never happen without the user knowing.
 *
 * Naming, corrected in #431. Two different years are involved and they must not
 * be conflated:
 *
 *   - DATASET YEAR  - what is installed and keyed on. The index calls the 2026
 *                     dataset "start-of-2026 fuels; input for 2026 model runs",
 *                     so dataset year == model year. This module resolves THAT.
 *   - FUEL VINTAGE  - the season the fuel data actually describes, which is
 *                     datasetYear - 1. See deriveFuelYears() in ./fuelYears.
 *
 * This module deliberately speaks in DATASET YEARS, because resolution and the
 * mismatch warning are about which dataset was installed and used. Anything
 * displayed as a "vintage" must come from deriveFuelYears, not from here.
 */

/** Mirrors the backend ResolvedFuelDataset (see IFuelDatasetCatalog). */
export interface ResolvedFuelDataset {
  requestedYear: number;
  vintage?: number;
  matchedRequestedYear: boolean;
  usedFallback: boolean;
  dataset?: {
    vintage: number;
    edition?: string;
    label?: string;
    producer?: string;
    provider?: string;
    buildDate?: string;
    resolutionM?: number;
  };
}

export type FuelVintageSeverity = 'none' | 'warning';

export interface FuelVintageDescription {
  /** Dataset year to display, or 'unknown' when nothing resolved. */
  datasetYearLabel: string;
  severity: FuelVintageSeverity;
  /** Present only when severity is 'warning'. */
  warning?: string;
  /** Always false — this never prevents a run. */
  blocking: false;
}

export function describeFuelVintage(
  resolved: ResolvedFuelDataset | undefined
): FuelVintageDescription {
  // No resolution yet (e.g. still loading). Nothing to say is not a warning.
  if (!resolved) {
    return { datasetYearLabel: 'unknown', severity: 'none', blocking: false };
  }

  const { requestedYear, vintage, matchedRequestedYear, usedFallback } = resolved;

  if (matchedRequestedYear && vintage !== undefined) {
    return { datasetYearLabel: String(vintage), severity: 'none', blocking: false };
  }

  // Fell back to default/, or default/ carries no vintage of its own.
  if (usedFallback) {
    if (vintage === undefined) {
      return {
        datasetYearLabel: 'unknown',
        severity: 'warning',
        warning:
          `No fuel dataset is installed for ${requestedYear}. ` +
          `The default dataset will be used, and its vintage is not recorded. ` +
          `Results may not reflect the fuel conditions of ${requestedYear}.`,
        blocking: false,
      };
    }

    // Name both years and the direction, so the user can judge whether it
    // matters for their fire rather than being told a bare mismatch.
    // Name the dataset year AND the fuel vintage it carries. Naming only one
    // is what #431 was about: the reader cannot tell which is meant.
    const direction = vintage > requestedYear ? 'newer' : 'older';

    return {
      datasetYearLabel: String(vintage),
      severity: 'warning',
      warning:
        `No fuel dataset is installed for model year ${requestedYear}, so this run uses the ` +
        `${vintage} dataset — ${vintage - 1}-vintage fuel — which is ${direction} than the ` +
        `${requestedYear - 1}-vintage fuel a ${requestedYear} run would normally use. ` +
        `Fuel that has since burned, regrown, or been reclassified may differ from ${requestedYear} conditions.`,
      blocking: false,
    };
  }

  // Neither the requested year nor a default dataset resolved.
  return {
    datasetYearLabel: 'unknown',
    severity: 'warning',
    warning:
      `No fuel dataset could be resolved for ${requestedYear}. ` +
      `Install the ${requestedYear} fuel dataset, or a default dataset, before relying on these results.`,
    blocking: false,
  };
}

/** A fuel vintage as recorded by the run that used it (#331). */
export interface RecordedFuelVintage {
  requestedYear: number;
  vintage: string;
  matchedRequestedYear: boolean;
  usedFallback: boolean;
  gridPath?: string;
  recordedAt?: string;
}

/**
 * Adapts a recorded vintage for display — issue #331.
 *
 * The run records the vintage DIRECTORY it used, which is a year ("2024") or
 * "default". The display type carries a numeric vintage, so a non-numeric
 * directory becomes undefined rather than being coerced into a year that was
 * never used.
 */
export function recordedToResolved(record: RecordedFuelVintage): ResolvedFuelDataset {
  const numeric = Number(record.vintage);

  return {
    requestedYear: record.requestedYear,
    vintage: Number.isInteger(numeric) ? numeric : undefined,
    matchedRequestedYear: record.matchedRequestedYear,
    usedFallback: record.usedFallback,
  };
}
