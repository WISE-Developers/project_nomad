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
export interface FireSizeSummaryArtifact {
  n: number;
  minHa: number;
  maxHa: number;
  meanHa: number;
  /** A true median. FireSTARR's logged median is the upper middle value. */
  medianHa: number;
  percentilesHa: Record<number, number>;
  degenerate: boolean;
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
   */
  extractDeterministicPerimeters(
    simDir: string,
  ): Promise<Result<DeterministicPerimeterExtraction, ValidationError | NotFoundError>>;

  /**
   * Read the per-day fire-size ensemble FireSTARR writes as `sizes_*.csv`.
   * A run with no such files yields a series whose `n` is null.
   */
  readFireSizeSeries(simDir: string): FireSizeSeriesArtifact;
}
