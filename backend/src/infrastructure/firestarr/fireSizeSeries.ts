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

/**
 * THE MEDIAN AND PERCENTILES ARE NEAREST-RANK, AND WITHHELD BELOW N = 11.
 *
 * #429 is answered: a row is one scenario's fire size at that save time.
 * `ProbabilityMap::saveSizes()` writes every element of `sizes_`, sorted, with
 * no cap, no sampling and no dedup — `insert_sorted` keeps duplicates, and 137
 * of 194 real size files contain duplicate values, so the file is the complete
 * set of what reported in rather than a subset of it.
 *
 * DEFINITION — FireSTARR's own, not the textbook one:
 *
 *   median_      = values[n / 2]                             // integer division
 *   percentile_i = values[ min(n-1, trunc((i/100) * n)) ]    // Statistics.h
 *
 * Determined from the code and the issue, not from preference:
 *
 * 1. #419 names the deliverable as "the same product FireGUARD publishes
 *    (McFayden et al. 2025, Fig. 5: Min / Average / Median / Max)", and the
 *    person who asked for it authored that figure. A conventional interpolated
 *    median would print a different number under the same label as his own.
 * 2. min, max and mean already reproduce EXACTLY from these rows. Matching four
 *    of five statistics and diverging on the fifth looks like agreement until
 *    somebody checks the one that differs.
 * 3. The scope asks for the "maximum SIMULATED fire size" to answer a resourcing
 *    question, so every figure published should be a fire the ensemble actually
 *    produced. An interpolated p90 is a size no simulation generated.
 *
 * For even N this returns the UPPER middle value — the log's `median` of
 * 209352/227341 is 227341, not 218346.5. That divergence is deliberate and must
 * stay documented on the product, or a user comparing us to `firestarr.log`
 * will reasonably conclude one of us is broken.
 *
 * THE FLOOR, which the same formulas force rather than taste:
 *
 *   n in {1, 2}  ->  the median IS the maximum
 *   n <= 10      ->  p90 and p95 are the same index (both the maximum)
 *   n >= 11      ->  p50, p90 and p95 are mutually distinct
 *
 * Below 11 the table would print four labels over one or two values, which is
 * the shape #419 already forbids at N=1 ("never a one-sample distribution").
 * Across 61 real runs the distinct N values are 2, 3, 14, 26, 29, 34, 35, 42,
 * 46, 142, 926, 1578, 3277, 4134 — nothing between 3 and 14 — so the floor does
 * not land inside the real distribution. 18 of 61 runs fall below it, 17 of
 * those at N=2.
 *
 * Withheld means NULL WITH A REASON, never omitted and never defaulted: a
 * silent default is a lie, and the UI has to be able to say why there is no
 * median instead of simply not showing one.
 *
 * Working: `Documentation/plans/nomad-429-sizes-csv-population.md`.
 */
export const FIRE_SIZE_PERCENTILE_FLOOR = 11;

export interface FireSizePercentiles {
  50: number;
  90: number;
  95: number;
}

/**
 * A DISCRIMINATED UNION, not nullable fields — Meridian's design call as the
 * consumer that vendors this boundary, and she is right about why.
 *
 * Two independently-nullable numbers plus an out-of-band reason string means
 * three presence checks that nothing stops from disagreeing: `medianHa: null`
 * with an empty reason, or a populated median beside a reason, are both
 * representable and both meaningless. This shape makes the bad state
 * unconstructible instead of merely discouraged, and the compiler forces a
 * consumer to handle `withheld` before it can read a median.
 *
 * `n` rides in the withheld branch deliberately: the honest message names the
 * number ("the ensemble had 2 members"), and if N lived only in the available
 * branch the UI would have to go looking elsewhere to explain itself.
 *
 * Her reason for insisting, which is better than an argument from taste: she
 * shipped a panel that drew seven "Not scheduled" rows when its fetch had
 * failed — stating as fact that a fire had been skipped when the truth was that
 * we did not know. A nullable number with a separate reason is the same hazard
 * in a different coat, because it lets a consumer render an absence as a value.
 */
export type FireSizePercentileStats =
  | { kind: 'available'; medianHa: number; percentilesHa: FireSizePercentiles }
  | { kind: 'withheld'; reason: string; n: number };

export interface FireSizeSummary {
  n: number;
  minHa: number;
  maxHa: number;
  meanHa: number;
  /** Every value identical — a real result, not a render failure. */
  degenerate: boolean;
  /** Nearest-rank median and p50/p90/p95, or an explicit withholding. */
  percentileStats: FireSizePercentileStats;
}

/**
 * FireSTARR's percentile index, `Statistics.h`. Exported so callers and tests
 * can state the rule independently of this module's own arithmetic.
 */
export function firestarrPercentileIndex(percentile: number, n: number): number {
  return Math.min(n - 1, Math.trunc((percentile / 100) * n));
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
 * See FireSizeSummary for the median/percentile definition and the N >= 11
 * floor, both of which are derived rather than chosen.
 */
export function summariseFireSizes(sizesHa: readonly number[]): FireSizeSummary {
  if (sizesHa.length === 0) {
    throw new Error('cannot summarise an empty fire-size distribution');
  }

  const sorted = [...sizesHa].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((acc, v) => acc + v, 0);

  const base = {
    n,
    minHa: sorted[0],
    maxHa: sorted[n - 1],
    meanHa: sum / n,
    degenerate: sorted[0] === sorted[n - 1],
  };

  if (n < FIRE_SIZE_PERCENTILE_FLOOR) {
    return {
      ...base,
      percentileStats: {
        kind: 'withheld',
        n,
        reason:
          `ensemble of ${n} is too small for a median or percentile: below ` +
          `${FIRE_SIZE_PERCENTILE_FLOOR} values, p90 and p95 resolve to the same ` +
          'simulation and at two or fewer the median is the maximum. Minimum, ' +
          'maximum, mean and N describe this ensemble; a median would not.',
      },
    };
  }

  return {
    ...base,
    percentileStats: {
      kind: 'available',
      // Integer division, matching FireSTARR's `values[n / 2]`: the UPPER middle
      // value for even n, deliberately not the midpoint.
      medianHa: sorted[Math.trunc(n / 2)],
      percentilesHa: {
        50: sorted[firestarrPercentileIndex(50, n)],
        90: sorted[firestarrPercentileIndex(90, n)],
        95: sorted[firestarrPercentileIndex(95, n)],
      },
    },
  };
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
