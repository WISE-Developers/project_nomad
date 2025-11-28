/**
 * FireSTARR Engine Types
 *
 * Type definitions for FireSTARR fire modeling engine.
 * Based on Documentation/Research/Onboarding/firestarr_io.md
 */

import { SpatialGeometry } from '../../domain/entities/index.js';

/**
 * Hourly weather observation with FWI indices.
 *
 * Note: FireSTARR expects pre-calculated FWI indices,
 * it does not calculate them from raw weather data.
 */
export interface WeatherHourlyData {
  /** Observation timestamp (hourly) */
  readonly date: Date;
  /** Temperature in Celsius */
  readonly temp: number;
  /** Relative humidity (0-100%) */
  readonly rh: number;
  /** Wind speed in km/h */
  readonly ws: number;
  /** Wind direction in degrees (0-360, from) */
  readonly wd: number;
  /** Precipitation in mm */
  readonly precip: number;
  /** Fine Fuel Moisture Code (0-101) */
  readonly ffmc: number;
  /** Duff Moisture Code (0+) */
  readonly dmc: number;
  /** Drought Code (0+) */
  readonly dc: number;
  /** Initial Spread Index (0+) */
  readonly isi: number;
  /** Build-up Index (0+) */
  readonly bui: number;
  /** Fire Weather Index (0+) */
  readonly fwi: number;
}

/**
 * Parameters for FireSTARR model execution.
 */
export interface FireSTARRParams {
  // === Required Parameters ===

  /** Ignition latitude (WGS84 decimal degrees) */
  readonly latitude: number;
  /** Ignition longitude (WGS84 decimal degrees) */
  readonly longitude: number;
  /** Simulation start date */
  readonly startDate: Date;
  /** Simulation start time (HH:MM format, local solar time) */
  readonly startTime: string;
  /** Hourly weather data array */
  readonly weatherData: WeatherHourlyData[];
  /** Previous day's FFMC (Fine Fuel Moisture Code) */
  readonly previousFFMC: number;
  /** Previous day's DMC (Duff Moisture Code) */
  readonly previousDMC: number;
  /** Previous day's DC (Drought Code) */
  readonly previousDC: number;

  // === Optional Parameters ===

  /** Previous day's precipitation in mm (default: 0) */
  readonly previousPrecip?: number;
  /** Fire perimeter polygon (will be rasterized to TIF) */
  readonly perimeter?: SpatialGeometry;
  /** Initial fire size in hectares (default: ~0.01) */
  readonly initialSize?: number;
  /** Output date offsets in days (default: [1,2,3,7,14]) */
  readonly outputDateOffsets?: number[];
  /** Scenario ID for weather (default: 0) */
  readonly scenarioId?: number;
}

/**
 * FireSTARR CLI command structure.
 *
 * Command format:
 * firestarr <output_dir> <yyyy-mm-dd> <lat> <lon> <HH:MM> [options]
 */
export interface FireSTARRCommand {
  /** Output/working directory */
  readonly outputDir: string;
  /** Start date (yyyy-mm-dd) */
  readonly startDate: string;
  /** Latitude (decimal degrees) */
  readonly latitude: number;
  /** Longitude (decimal degrees) */
  readonly longitude: number;
  /** Start time (HH:MM) */
  readonly startTime: string;
  /** Weather file path (--wx) */
  readonly weatherFile: string;
  /** Previous FFMC (--ffmc) */
  readonly ffmc: number;
  /** Previous DMC (--dmc) */
  readonly dmc: number;
  /** Previous DC (--dc) */
  readonly dc: number;
  /** Previous precipitation (--apcp_prev) */
  readonly previousPrecip?: number;
  /** Perimeter TIF path (--perim) */
  readonly perimeterFile?: string;
  /** Initial fire size (--size) */
  readonly initialSize?: number;
  /** Output date offsets (--output_date_offsets) */
  readonly outputDateOffsets?: number[];
  /** Verbosity level (-v repeats) */
  readonly verbosity?: number;
}

/**
 * FireSTARR output file patterns.
 */
export const FIRESTARR_OUTPUT_PATTERNS = {
  /** Probability output: probability_001_2024-06-15.tif */
  PROBABILITY: /^probability_(\d{3})_(\d{4}-\d{2}-\d{2})\.tif$/,
  /** Interim probability: interim_probability_001.tif */
  INTERIM_PROBABILITY: /^interim_probability_(\d{3})\.tif$/,
  /** Log file */
  LOG: 'firestarr.log',
} as const;

/**
 * Success indicator in FireSTARR log.
 */
export const FIRESTARR_SUCCESS_PATTERN = /Total simulation time was (\d+(?:\.\d+)?) seconds/;

/**
 * Error patterns in FireSTARR log.
 */
export const FIRESTARR_ERROR_PATTERNS = [
  /\[FATAL\]\s+(.+)/,
  /\[ERROR\]\s+(.+)/,
] as const;

/**
 * Warning patterns in FireSTARR log.
 */
export const FIRESTARR_WARNING_PATTERNS = [
  /\[WARNING\]\s+(.+)/,
] as const;

/**
 * Progress pattern in FireSTARR output.
 * Note: FireSTARR may not output progress in real-time,
 * but convergence info appears in log.
 */
export const FIRESTARR_PROGRESS_PATTERNS = [
  /Running scenario (\d+) of (\d+)/,
  /Convergence achieved at iteration (\d+)/,
] as const;
