/** Mirrors the backend response of `GET /models/:id/fire-sizes` (#418). */

export interface FireSizeSummary {
  n: number;
  minHa: number;
  maxHa: number;
  meanHa: number;
  medianHa: number;
  percentilesHa: Record<number, number>;
  degenerate: boolean;
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
