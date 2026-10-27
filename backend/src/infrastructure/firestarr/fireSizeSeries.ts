/**
 * Per-simulation fire sizes as FireSTARR actually writes them (#418).
 *
 * FireSTARR emits one `sizes_{julianDay}_{date}.csv` per output day holding the
 * fire sizes, in HECTARES, of the scenarios it summarised for that day. Until
 * now NOMAD's only reference to these files was a filename regex used to label
 * them in the export ZIP: we shipped the ensemble to the user and never read it.
 *
 * Four properties of the real files drive this module, each measured across 61
 * run directories and 194 size files rather than assumed. They are documented
 * here because every one of them is a trap:
 *
 * 1. THE CSV IS THE POPULATION. The statistics FireSTARR prints to its log
 *    reproduce exactly from these values, so the log is a view of the file and
 *    not an independent product. The file is what we read.
 *
 * 2. ONE ROW PER SIMULATION IS FALSE. Run c7ea0072 logs `Ran 6 simulations`
 *    with six distinct final sizes, and every one of its seven CSVs holds two
 *    rows. Row count tracks the scenario count with a constant offset nobody
 *    has explained. So N is taken from the row count and from nothing else.
 *
 * 3. FIRESTARR'S LOGGED "MEDIAN" IS NOT A MEDIAN. On every even-length
 *    distribution it is the upper middle value: N=46 logs 3088 where the median
 *    is 3079, N=14 logs 3883 where it is 3655. Odd N agrees, which is why it is
 *    easy to miss. We compute our own.
 *
 * 4. LARGE VALUES ARE WRITTEN IN %g FORM AND LOSE PRECISION. Run 555dccae
 *    writes `1.64288e+06` where its log says `1642885.0` — five hectares short
 *    at six significant figures. A parser written against the small-fire
 *    samples (`1`, `3650`, `209352`) returns NaN on a megafire, and NaN reaching
 *    the engine is the expensive kind of silent.
 */

import { readdirSync, readFileSync, type Dirent } from 'fs';
import { join } from 'path';

/** Filename shapes the export manifest already accepts (`exportManifest.ts`). */
export const SIZES_FILENAME_RE = /^sizes_(\d+)(?:_(\d{4}-\d{2}-\d{2}))?\.csv$/;

export interface ParsedSizes {
  /** Fire sizes in hectares, file order preserved. */
  sizesHa: number[];
  /** The ensemble size. A property of THIS FILE, never of the log. */
  n: number;
  /**
   * True when at least one value was written in exponential form, so its
   * magnitude is exact only to six significant figures. Reported rather than
   * corrected: the lost digits are not recoverable from the file.
   */
  reducedPrecision: boolean;
}

export interface FireSizeSummary {
  n: number;
  minHa: number;
  maxHa: number;
  meanHa: number;
  /** A true median: the mean of the two middle values when N is even. */
  medianHa: number;
  percentilesHa: Record<number, number>;
  /** Every value identical — a real result, not a render failure. */
  degenerate: boolean;
}

/**
 * Parse one `sizes_*.csv`. Throws rather than returning an empty or partial
 * ensemble: an N of zero would render as a genuine distribution, and a dropped
 * row would silently bias every statistic computed from it.
 */
export function parseSizesCsv(text: string): ParsedSizes {
  const tokens = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (tokens.length === 0) {
    throw new Error(
      'no fire sizes in this file: an empty sizes CSV is not a zero-sized ensemble, ' +
        'and reporting N=0 would render as a real distribution',
    );
  }

  let reducedPrecision = false;
  const sizesHa = tokens.map(token => {
    const value = Number(token);
    if (!Number.isFinite(value)) {
      throw new Error(
        `unparseable fire size ${JSON.stringify(token)}: refusing to drop a row, ` +
          'because a missing scenario biases every statistic over this file',
      );
    }
    if (/[eE]/.test(token)) reducedPrecision = true;
    return value;
  });

  return { sizesHa, n: sizesHa.length, reducedPrecision };
}

/**
 * Summary statistics computed from the parsed values.
 *
 * Percentiles use linear interpolation between order statistics, which is the
 * conventional default and makes p50 agree with the median by construction.
 */
export function summariseFireSizes(
  sizesHa: readonly number[],
  percentiles: readonly number[] = [50, 90, 95],
): FireSizeSummary {
  if (sizesHa.length === 0) {
    throw new Error('cannot summarise an empty fire-size distribution');
  }

  const sorted = [...sizesHa].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((acc, v) => acc + v, 0);

  const percentilesHa: Record<number, number> = {};
  for (const p of percentiles) percentilesHa[p] = quantile(sorted, p / 100);

  return {
    n,
    minHa: sorted[0],
    maxHa: sorted[n - 1],
    meanHa: sum / n,
    medianHa: quantile(sorted, 0.5),
    percentilesHa,
    degenerate: sorted[0] === sorted[n - 1],
  };
}

/** Linear-interpolated quantile over a pre-sorted ascending array. */
function quantile(sorted: readonly number[], q: number): number {
  const n = sorted.length;
  if (n === 1) return sorted[0];
  const pos = (n - 1) * q;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (pos - lower) * (sorted[upper] - sorted[lower]);
}

export interface SizesFileIdentity {
  julianDay: number;
  /** Null for the dateless filename form, which the manifest also accepts. */
  date: string | null;
}

/** Identify a sizes file from its name, or null when it is not one. */
export function parseSizesFilename(filename: string): SizesFileIdentity | null {
  const m = filename.match(SIZES_FILENAME_RE);
  if (!m) return null;
  return { julianDay: Number(m[1]), date: m[2] ?? null };
}

/** One output day's fire-size distribution. */
export interface FireSizeDay {
  julianDay: number;
  date: string | null;
  sizesHa: number[];
  summary: FireSizeSummary;
  reducedPrecision: boolean;
}

export interface FireSizeSeries {
  /** Ascending by Julian day. Empty when the run recorded no ensemble. */
  days: FireSizeDay[];
  /**
   * The ensemble size. NULL when no sizes files exist, which is "no ensemble
   * recorded" and must not render as an ensemble of size zero. 12 of 73 real
   * run directories are in that state.
   */
  n: number | null;
  /**
   * False when the row count differs between days. Not observed in any of the
   * 61 real runs, and flagged rather than smoothed: a population that changes
   * between days silently invalidates any day-over-day comparison drawn from it.
   */
  nConstantAcrossDays: boolean;
  /** True when any day carried a value written in reduced precision. */
  reducedPrecision: boolean;
}

/**
 * Read every `sizes_*.csv` in a simulation directory.
 *
 * A missing or unreadable directory yields an empty series rather than
 * throwing: callers distinguish "no ensemble recorded" from "an ensemble of
 * zero" through `n`, and a deterministic run legitimately has neither.
 */
export function readFireSizeSeries(simDir: string): FireSizeSeries {
  let entries: Dirent[];
  try {
    entries = readdirSync(simDir, { withFileTypes: true });
  } catch {
    return { days: [], n: null, nConstantAcrossDays: true, reducedPrecision: false };
  }

  const days: FireSizeDay[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const identity = parseSizesFilename(entry.name);
    if (!identity) continue;
    const parsed = parseSizesCsv(readFileSync(join(simDir, entry.name), 'utf8'));
    days.push({
      julianDay: identity.julianDay,
      date: identity.date,
      sizesHa: parsed.sizesHa,
      summary: summariseFireSizes(parsed.sizesHa),
      reducedPrecision: parsed.reducedPrecision,
    });
  }

  days.sort((a, b) => a.julianDay - b.julianDay);

  const counts = days.map(d => d.summary.n);
  return {
    days,
    n: counts.length === 0 ? null : Math.max(...counts),
    nConstantAcrossDays: new Set(counts).size <= 1,
    reducedPrecision: days.some(d => d.reducedPrecision),
  };
}
