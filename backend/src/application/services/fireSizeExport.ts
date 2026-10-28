/**
 * The fire-size ensemble as DATA in the export payload (#419).
 *
 * The raw `sizes_*.csv` files already ship inside the export ZIP — they have
 * since before anything read them — but only as unexplained columns of
 * numbers. This adds the computed view beside them: N, the statistics, and the
 * two caveats a reader cannot recover from the numbers themselves.
 *
 * The per-simulation values are included deliberately. "As data, not only as a
 * picture" means a consumer can recompute a statistic we did not think to
 * provide, which they cannot do from a summary alone. It is also what makes
 * withholding the median defensible rather than lossy: the values are all here,
 * so a reader who learns the population rule can compute one themselves.
 */

import type { FireSizeSeriesArtifact } from '../interfaces/index.js';

const PROVENANCE =
  'Computed by NOMAD from the per-day sizes_{julianDay}_{date}.csv files written by ' +
  'FireSTARR, not taken from firestarr.log. N is the row count of each CSV, which is ' +
  'NOT the simulation count the log reports: a run logging six simulations has been ' +
  'observed writing two rows. Each row is one scenario\'s fire size at that save ' +
  'time, and the file is the complete set of what reported — FireSTARR writes every ' +
  'value it holds, sorted, with no sampling and no de-duplication (project_nomad#429). ' +
  'MEDIAN AND PERCENTILE DEFINITION: nearest-rank, matching FireSTARR\'s own ' +
  'Statistics.h — median = values[n/2] and percentile i = values[min(n-1, ' +
  'trunc((i/100)*n))]. There is no interpolation, so every figure reported is a fire ' +
  'size the ensemble actually produced, and for an even N the median is the UPPER of ' +
  'the two middle values rather than their average. That is deliberate: it agrees with ' +
  'the median firestarr.log prints and with the Min/Average/Median/Max table FireGUARD ' +
  'publishes (McFayden et al. 2025, Fig. 5), where a conventional interpolated median ' +
  'would have disagreed with both. BELOW N=11 the median and percentiles are WITHHELD ' +
  'rather than reported, and percentileStats.kind is "withheld" with a reason: the same ' +
  'formulas put p90 and p95 on one index for N<=10, and make the median equal the ' +
  'maximum at N<=2, so the labels would print over a single value. Minimum, maximum, ' +
  'mean and N still describe the rows present. The per-simulation values ship in full ' +
  'beside this summary, so any other definition can be recomputed from them.';

/**
 * Returns pretty-printed JSON, or null when the run recorded no ensemble —
 * shipping an empty file would read as an ensemble of zero.
 */
export function buildFireSizeExport(series: FireSizeSeriesArtifact): string | null {
  if (series.n === null || series.days.length === 0) return null;

  return `${JSON.stringify(
    {
      units: 'hectares',
      n: series.n,
      nConstantAcrossDays: series.nConstantAcrossDays,
      reducedPrecision: series.reducedPrecision,
      provenance: PROVENANCE,
      days: series.days.map(day => ({
        julianDay: day.julianDay,
        date: day.date,
        summary: day.summary,
        sizesHa: day.sizesHa,
        reducedPrecision: day.reducedPrecision,
      })),
    },
    null,
    2,
  )}\n`;
}
