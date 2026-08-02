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
 * Convention: vintage = RUN year (start-of-year fuel state). A run in year N
 * uses dataset N. Not off-by-one.
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
  /** Vintage to display, or 'unknown' when nothing resolved. */
  vintageLabel: string;
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
    return { vintageLabel: 'unknown', severity: 'none', blocking: false };
  }

  const { requestedYear, vintage, matchedRequestedYear, usedFallback } = resolved;

  if (matchedRequestedYear && vintage !== undefined) {
    return { vintageLabel: String(vintage), severity: 'none', blocking: false };
  }

  // Fell back to default/, or default/ carries no vintage of its own.
  if (usedFallback) {
    if (vintage === undefined) {
      return {
        vintageLabel: 'unknown',
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
    const direction =
      vintage > requestedYear
        ? `newer fuel (${vintage}) than the modelled year (${requestedYear})`
        : `older fuel (${vintage}) than the modelled year (${requestedYear})`;

    return {
      vintageLabel: String(vintage),
      severity: 'warning',
      warning:
        `No fuel dataset is installed for ${requestedYear}, so this run uses ${direction}. ` +
        `Fuel that has since burned, regrown, or been reclassified may differ from ${requestedYear} conditions.`,
      blocking: false,
    };
  }

  // Neither the requested year nor a default dataset resolved.
  return {
    vintageLabel: 'unknown',
    severity: 'warning',
    warning:
      `No fuel dataset could be resolved for ${requestedYear}. ` +
      `Install the ${requestedYear} fuel dataset, or a default dataset, before relying on these results.`,
    blocking: false,
  };
}
