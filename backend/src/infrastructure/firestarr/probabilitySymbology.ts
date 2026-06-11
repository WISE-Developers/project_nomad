/**
 * probabilitySymbology — the single backend authority for burn-probability
 * contour bands. Issue #283 / #270 / #190.
 *
 * Standardized on the FireSTARR SLD ramp (static symbology). The legacy
 * "dynamic"/quantile mode is dropped. Contours are "prob >= threshold" with
 * higher thresholds drawn on top, so each band's `threshold` is its LOWER bound
 * and that band's colour fills [threshold, nextThreshold).
 *
 * The low band starts at MIN_PROBABILITY ("any burn probability > 0", per #270
 * / Den Boychuk) — the SLD's blue 0-10% class. This fixes both the #270 0% trim
 * and the prior off-by-one (blue was mislabeled "10%"). Colours/labels are the
 * vendored SLD ramp, matching the frontend palettes.ts legend.
 *
 * Source SLD: CWFMF/FireSTARR gis/symbology/probability_processing.sld @93fc5aa
 */

/**
 * Smallest probability treated as a burn. Equals the SLD's `<= 0.0` sentinel
 * boundary (quantity 0.0000000001 = 1e-10): anything strictly above it is a
 * real burn probability and renders as the blue low class. (#270)
 */
export const MIN_PROBABILITY = 1e-10;

/** A burn-probability contour band: a lower-bound threshold, SLD colour, label. */
export interface ProbabilityBand {
  /** Lower bound; the contour mask selects pixels with prob >= threshold. */
  threshold: number;
  /** SLD hex colour for the band. */
  color: string;
  /** Percent band label, e.g. "0-10%" or ">90%". */
  label: string;
}

/**
 * The 10 SLD probability colours, low (blue) -> high (red).
 * Verbatim from probability_processing.sld (the FireSTARR authority).
 */
const SLD_COLORS = [
  '#00B1F2', // 0-10%  - cool blue (lowest)
  '#FAF68E', // 10-20% - light yellow
  '#FCDF4B', // 20-30% - yellow
  '#FAC044', // 30-40% - yellow-orange
  '#F5A23D', // 40-50% - orange
  '#F28938', // 50-60% - dark orange
  '#F06C33', // 60-70% - red-orange
  '#EE4F2C', // 70-80% - red
  '#EB3326', // 80-90% - dark red
  '#E6151F', // >90%   - darkest red (highest)
] as const;

/**
 * Lower-bound thresholds per band. The first band starts at MIN_PROBABILITY
 * (any prob > 0); the rest sit on the decile breaks 0.1 .. 0.9.
 */
const SLD_THRESHOLDS = [MIN_PROBABILITY, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

/**
 * The standard FireSTARR static probability bands (SLD symbology), low -> high.
 * The single source of truth for contour colours and labels.
 */
export const STATIC_PROBABILITY_BANDS: ProbabilityBand[] = SLD_COLORS.map(
  (color, i) => {
    const lowerPct = i === 0 ? 0 : Math.round(SLD_THRESHOLDS[i] * 100);
    const isTop = i === SLD_COLORS.length - 1;
    return {
      threshold: SLD_THRESHOLDS[i],
      color,
      label: isTop ? `>${lowerPct}%` : `${lowerPct}-${lowerPct + 10}%`,
    };
  },
);
