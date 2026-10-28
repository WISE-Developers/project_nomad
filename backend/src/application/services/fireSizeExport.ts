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
  'observed writing two rows. Because the rows are therefore an unknown subset of the ' +
  'ensemble, no median and no percentiles are reported — only statistics describing ' +
  'the rows present. See project_nomad#429.';

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
