/**
 * Shaping an ensemble of fire sizes for display (#419).
 *
 * The ensemble is the per-simulation final fire sizes FireSTARR writes, served
 * by `GET /models/:id/fire-sizes`. The question these products answer is
 * Colin's: "are most simulations producing relatively small fires requiring
 * limited response, or is there meaningful potential for large incidents?"
 *
 * Degenerate distributions are a first-class case, not an edge case: of 194
 * real size files, 33 hold a single repeated value and 47 hold only two rows.
 * Each function below returns something honest for those rather than dividing
 * by a zero range.
 */

/** The largest number of histogram bars worth drawing at panel width. */
const MAX_BINS = 20;

export interface EcdfPoint {
  sizeHa: number;
  /** Proportion of simulations at or below this size, ending at exactly 1. */
  proportion: number;
}

/**
 * Empirical CDF, one point per DISTINCT size.
 *
 * Tied values share a single point carrying their combined proportion: drawing
 * one point per simulation would stack several at the same x and make a tie
 * look like a vertical run of separate outcomes.
 */
export function ecdfPoints(sizesHa: readonly number[]): EcdfPoint[] {
  if (sizesHa.length === 0) return [];
  const sorted = [...sizesHa].sort((a, b) => a - b);
  const n = sorted.length;
  const points: EcdfPoint[] = [];
  for (let i = 0; i < n; i++) {
    const size = sorted[i];
    if (i + 1 < n && sorted[i + 1] === size) continue;
    points.push({ sizeHa: size, proportion: (i + 1) / n });
  }
  return points;
}

export interface HistogramBin {
  fromHa: number;
  toHa: number;
  count: number;
}

/**
 * Equal-width bins over the observed range.
 *
 * Bin count is `min(MAX_BINS, ceil(sqrt(n)))` — the square-root rule, capped
 * so a 4134-member ensemble does not render 4134 bars in a side panel.
 *
 * The final bin is CLOSED at the top so the maximum lands inside it. A
 * half-open last bin silently drops the largest fire, which is precisely the
 * outcome the user is asking about.
 */
export function histogramBins(sizesHa: readonly number[]): HistogramBin[] {
  if (sizesHa.length === 0) return [];

  const sorted = [...sizesHa].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  // Every value identical: one bin of zero width, which is the truth about
  // this ensemble rather than an arithmetic failure.
  if (min === max) {
    return [{ fromHa: min, toHa: max, count: sorted.length }];
  }

  const binCount = Math.min(MAX_BINS, Math.max(1, Math.ceil(Math.sqrt(sorted.length))));
  const width = (max - min) / binCount;

  const bins: HistogramBin[] = Array.from({ length: binCount }, (_, i) => ({
    fromHa: min + i * width,
    toHa: i === binCount - 1 ? max : min + (i + 1) * width,
    count: 0,
  }));

  for (const value of sorted) {
    let index = Math.floor((value - min) / width);
    if (index >= binCount) index = binCount - 1; // the maximum
    if (index < 0) index = 0;
    bins[index].count += 1;
  }

  return bins;
}
