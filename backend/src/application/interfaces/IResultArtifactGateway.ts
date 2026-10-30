/**
 * Result Artifact Gateway (application port)
 *
 * Abstracts the filesystem/raster artifact operations the ModelResultsService
 * needs from the FireSTARR infrastructure. Defined in the application layer so
 * the service depends on this abstraction rather than concrete infrastructure
 * (Dependency Inversion Principle). The infrastructure layer provides the
 * concrete implementation.
 *
 * NOTE: The return types below are application-owned mirrors of the shapes the
 * concrete firestarr functions return. They are intentionally declared here
 * (not imported from infrastructure) so this port introduces no inward
 * dependency on the infrastructure layer.
 */

import type { Result } from '../common/index.js';
import type { ValidationError, NotFoundError } from '../../domain/errors/index.js';
import type { Feature, Polygon, MultiPolygon } from 'geojson';

/**
 * Discovered arrival-time raster information.
 * Application-owned mirror of the infrastructure `ArrivalTifInfo` shape.
 */
export interface ArrivalArtifactInfo {
  /** Highest-Julian-day file — the most complete cumulative view */
  filePath: string;
  /** First Julian day (classification origin) */
  offsetDay: number;
  /** Last Julian day + 1 (end of model window) */
  endJulian: number;
  /** All discovered Julian days, ascending */
  julianDays: number[];
}

/**
 * A single extracted deterministic fire perimeter.
 * Application-owned mirror of the infrastructure `DeterministicPerimeter` shape.
 */
export interface DeterministicPerimeterArtifact {
  /** Julian day of the simulation */
  julianDay: number;
  /** Date string (YYYY-MM-DD) if derivable from Julian day + start date */
  date: string | null;
  /** GeoJSON polygon representing the fire boundary */
  geojson: Feature<Polygon | MultiPolygon>;
}

/**
 * Result of extracting perimeters from all arrival grids.
 * Application-owned mirror of the infrastructure `DeterministicExtractionResult`.
 */
export interface DeterministicPerimeterExtraction {
  perimeters: DeterministicPerimeterArtifact[];
  totalGrids: number;
  successCount: number;
}

/**
 * Summary statistics over one day's fire-size distribution.
 * Application-owned mirror of the infrastructure `FireSizeSummary` shape.
 */
/** Nearest-rank p50/p90/p95, FireSTARR's own convention. */
export interface FireSizePercentilesArtifact {
  50: number;
  90: number;
  95: number;
}

/**
 * A DISCRIMINATED UNION rather than nullable fields, so a consumer gets one
 * presence check and cannot read a median without handling its absence.
 *
 * Two independently-nullable numbers plus an out-of-band reason string would
 * let `medianHa: null` coexist with an empty reason, or a populated median sit
 * beside one — both representable, both meaningless. This shape makes the bad
 * state unconstructible instead of merely discouraged. `n` rides in the
 * withheld branch so a caller can name the number ("the ensemble had 2
 * members") rather than hiding a row.
 */
export type FireSizePercentileStatsArtifact =
  | { kind: 'available'; medianHa: number; percentilesHa: FireSizePercentilesArtifact }
  | { kind: 'withheld'; reason: string; n: number };

/**
 * #429 is answered: each row is one scenario's fire size at that save time, and
 * the file is the complete set of what reported in — FireSTARR writes every
 * value it holds, sorted, with no sampling and no de-duplication.
 *
 * So the median and percentiles are reported, nearest-rank per FireSTARR's
 * `Statistics.h`, and WITHHELD below N=11 where the same formulas collapse
 * p90/p95 onto one index and make the median the maximum at N<=2.
 */
export interface FireSizeSummaryArtifact {
  n: number;
  minHa: number;
  maxHa: number;
  meanHa: number;
  /** Every value identical — a real result, not a render failure. */
  degenerate: boolean;
  /** Nearest-rank median and p50/p90/p95, or an explicit withholding. */
  percentileStats: FireSizePercentileStatsArtifact;
}

/** One output day of the fire-size ensemble. */
export interface FireSizeDayArtifact {
  julianDay: number;
  date: string | null;
  sizesHa: number[];
  summary: FireSizeSummaryArtifact;
  reducedPrecision: boolean;
}

/**
 * A run's per-day fire-size ensemble (#418).
 * Application-owned mirror of the infrastructure `FireSizeSeries` shape.
 */
export interface FireSizeSeriesArtifact {
  days: FireSizeDayArtifact[];
  /** Null when the run recorded no ensemble — never zero. */
  n: number | null;
  nConstantAcrossDays: boolean;
  reducedPrecision: boolean;
}

/**
 * Port exposing the artifact operations ModelResultsService requires.
 */
export interface IResultArtifactGateway {
  /**
   * Resolve a stored relative result file path to an absolute path.
   */
  resolveResultFilePath(relativePath: string): string;

  /**
   * Discover arrival-time rasters in a simulation directory.
   * Returns null when no arrival rasters are present.
   */
  findArrivalTifs(simDir: string): ArrivalArtifactInfo | null;

  /**
   * Extract deterministic fire perimeters from arrival-time rasters.
   *
   * `startYear` is the year the model was simulated for, and it is the ONLY
   * source of one (#492). A Julian day carries no year; when this is omitted
   * each perimeter's `date` is null and callers label it by relative day. The
   * extractor used to sniff `weather.csv` for a year and otherwise substitute
   * today, which named a 2023 reconstruction with the current year.
   */
  extractDeterministicPerimeters(
    simDir: string,
    startYear?: number,
  ): Promise<Result<DeterministicPerimeterExtraction, ValidationError | NotFoundError>>;

  /**
   * Read the per-day fire-size ensemble FireSTARR writes as `sizes_*.csv`.
   * A run with no such files yields a series whose `n` is null.
   */
  readFireSizeSeries(simDir: string): FireSizeSeriesArtifact;
}
