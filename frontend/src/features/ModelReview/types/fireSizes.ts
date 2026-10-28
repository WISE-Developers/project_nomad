/** Mirrors the backend response of `GET /models/:id/fire-sizes` (#418). */


/** Nearest-rank p50/p90/p95, FireSTARR's own convention (`Statistics.h`). */
export interface FireSizePercentiles {
  50: number;
  90: number;
  95: number;
}

/**
 * A discriminated union, not nullable fields: one presence check, and the UI
 * cannot read a median without handling its absence. `n` rides in the withheld
 * branch so the message can name the number instead of hiding a row.
 */
export type FireSizePercentileStats =
  | { kind: 'available'; medianHa: number; percentilesHa: FireSizePercentiles }
  | { kind: 'withheld'; reason: string; n: number };

export interface FireSizeSummary {
  n: number;
  minHa: number;
  maxHa: number;
  meanHa: number;
  degenerate: boolean;
  /** Nearest-rank median and percentiles, or an explicit withholding. */
  percentileStats: FireSizePercentileStats;
}

export interface FireSizeDay {
  julianDay: number;
  date: string | null;
  sizesHa: number[];
  summary: FireSizeSummary;
  reducedPrecision: boolean;
}

export interface FireSizeSeries {
  days: FireSizeDay[];
  /** Null when the run recorded no ensemble — never zero. */
  n: number | null;
  nConstantAcrossDays: boolean;
  reducedPrecision: boolean;
}

export interface FireSizeResolution {
  /** False means no ensemble was RECORDED, not an ensemble of zero. */
  hasEnsemble: boolean;
  series: FireSizeSeries | null;
  reason: string | null;
}
