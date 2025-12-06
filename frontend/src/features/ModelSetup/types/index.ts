/**
 * ModelSetup Types
 *
 * Type definitions for the Model Setup wizard workflow.
 */

import type { DrawnFeature, DrawingMode } from '../../Map/types/geometry';

/**
 * Bounding box as [minLng, minLat, maxLng, maxLat]
 */
export type BoundingBox = [number, number, number, number];

/**
 * Input method for spatial data
 */
export type SpatialInputMethod = 'draw' | 'coordinates' | 'upload';

/**
 * Fire model engine types
 */
export type FireEngine = 'firestarr' | 'wise';

/**
 * Model run types
 */
export type RunType = 'deterministic' | 'probabilistic';

/**
 * Weather data source
 */
export type WeatherSource = 'firestarr_csv' | 'raw_weather' | 'spotwx';

/**
 * Fire danger rating based on FWI
 */
export type FireDangerRating = 'Low' | 'Moderate' | 'High' | 'Very High' | 'Extreme';

/**
 * FWI indices for manual weather input (legacy - kept for compatibility)
 */
export interface FWIValues {
  /** Fine Fuel Moisture Code (0-101) */
  ffmc: number;
  /** Duff Moisture Code (0+) */
  dmc: number;
  /** Drought Code (0+) */
  dc: number;
  /** Initial Spread Index (0+) */
  isi: number;
  /** Buildup Index (0+) */
  bui: number;
  /** Fire Weather Index (0+) */
  fwi: number;
}

/**
 * FWI starting codes for progressive calculation
 * These are the initial values used to begin CFFDRS calculations
 */
export interface FWIStartingCodes {
  /** Fine Fuel Moisture Code (0-101) */
  ffmc: number;
  /** Duff Moisture Code (0+) */
  dmc: number;
  /** Drought Code (0+) */
  dc: number;
}

/**
 * Spatial input step data
 */
export interface SpatialData {
  /** Geometry type being drawn */
  type: DrawingMode;
  /** Drawn GeoJSON features */
  features: DrawnFeature[];
  /** Calculated bounding box */
  bounds?: BoundingBox;
  /** How the geometry was input */
  inputMethod: SpatialInputMethod;
}

/**
 * Temporal parameters step data
 */
export interface TemporalData {
  /** Start date in YYYY-MM-DD format */
  startDate: string;
  /** Start time in HH:mm format */
  startTime: string;
  /** Duration in hours (1-720) */
  durationHours: number;
  /** IANA timezone identifier */
  timezone: string;
  /** Whether the start date is in the future (forecast mode) */
  isForecast: boolean;
}

/**
 * Model selection step data
 */
export interface ModelData {
  /** Selected fire modeling engine */
  engine: FireEngine;
  /** Deterministic or probabilistic run */
  runType: RunType;
}

/**
 * Parsed weather CSV data for validation preview
 */
export interface ParsedWeatherCSV {
  /** Column headers found in the file */
  headers: string[];
  /** Number of data rows */
  rowCount: number;
  /** First few rows for preview */
  previewRows: string[][];
  /** Whether Scenario column is present */
  hasScenarioColumn: boolean;
  /** Whether all FWI columns are present (FFMC, DMC, DC, ISI, BUI, FWI) */
  hasFWIColumns: boolean;
}

/**
 * Weather step data
 */
export interface WeatherData {
  /** Weather data source */
  source: WeatherSource;
  /** For firestarr_csv: Complete weather file with FWI columns */
  firestarrCsvFile?: File;
  firestarrCsvFileName?: string;
  firestarrCsvParsed?: ParsedWeatherCSV;
  /** For raw_weather: Weather file without FWI columns */
  rawWeatherFile?: File;
  rawWeatherFileName?: string;
  rawWeatherParsed?: ParsedWeatherCSV;
  /** Starting codes for raw_weather source (used by backend for CFFDRS calculation) */
  startingCodes?: FWIStartingCodes;
  /** Legacy: Manual FWI values (kept for compatibility) */
  fwi?: FWIValues;
}

/**
 * Execution preferences from review step
 */
export interface ExecutionPreferences {
  /** Send email notification on completion */
  notifyEmail: boolean;
  /** Send push notification on completion */
  notifyPush: boolean;
  /** Optional notes for the model run */
  notes?: string;
}

/**
 * Complete model setup form data
 */
export interface ModelSetupData extends Record<string, unknown> {
  /** Step 1: Spatial input */
  geometry: SpatialData;
  /** Step 2: Temporal parameters */
  temporal: TemporalData;
  /** Step 3: Model selection */
  model: ModelData;
  /** Step 4: Weather data */
  weather: WeatherData;
  /** Step 5: Execution preferences */
  execution?: ExecutionPreferences;
}

/**
 * Result returned after model execution request
 */
export interface ExecutionResult {
  /** Unique model ID (format: NOMAD-YYYYMMDD-XXXXX) */
  modelId: string;
  /** URL to check model status */
  statusUrl: string;
  /** Estimated run duration in minutes */
  estimatedDuration: number;
}

/**
 * Wizard step IDs for Model Setup
 */
export type ModelSetupStepId = 'spatial' | 'temporal' | 'model' | 'weather' | 'review';

/**
 * Step configuration for Model Setup wizard
 */
export const MODEL_SETUP_STEPS = [
  {
    id: 'spatial' as const,
    name: 'Location',
    description: 'Define the fire ignition or perimeter location',
    icon: 'location-dot',
  },
  {
    id: 'temporal' as const,
    name: 'Time Range',
    description: 'Set the simulation start time and duration',
    icon: 'clock',
  },
  {
    id: 'model' as const,
    name: 'Model',
    description: 'Select the fire modeling engine and run type',
    icon: 'fire',
  },
  {
    id: 'weather' as const,
    name: 'Weather',
    description: 'Provide fire weather index values',
    icon: 'cloud-sun',
  },
  {
    id: 'review' as const,
    name: 'Review',
    description: 'Review settings and start the model',
    icon: 'circle-check',
  },
] as const;

/**
 * Default values for a new model setup
 */
export const DEFAULT_MODEL_SETUP_DATA: ModelSetupData = {
  geometry: {
    type: 'none',
    features: [],
    inputMethod: 'draw',
  },
  temporal: {
    startDate: '',
    startTime: '12:00',
    durationHours: 24,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    isForecast: false,
  },
  model: {
    engine: 'firestarr',
    runType: 'deterministic',
  },
  weather: {
    source: 'firestarr_csv',
  },
};

/**
 * Spring startup FWI values (typical Canadian spring conditions)
 */
export const SPRING_STARTUP_FWI: FWIValues = {
  ffmc: 85,
  dmc: 6,
  dc: 15,
  isi: 0,
  bui: 0,
  fwi: 0,
};

/**
 * Spring startup starting codes (typical Canadian spring conditions)
 * Used to initialize CFFDRS progressive calculations
 */
export const SPRING_STARTUP_CODES: FWIStartingCodes = {
  ffmc: 85,
  dmc: 6,
  dc: 15,
};

/**
 * Get fire danger rating from FWI value
 */
export function getFireDangerRating(fwi: number): FireDangerRating {
  if (fwi < 5) return 'Low';
  if (fwi < 10) return 'Moderate';
  if (fwi < 20) return 'High';
  if (fwi < 30) return 'Very High';
  return 'Extreme';
}

/**
 * Get color for fire danger rating
 */
export function getFireDangerColor(rating: FireDangerRating): string {
  switch (rating) {
    case 'Low':
      return '#2ecc71'; // green
    case 'Moderate':
      return '#3498db'; // blue
    case 'High':
      return '#f1c40f'; // yellow
    case 'Very High':
      return '#e67e22'; // orange
    case 'Extreme':
      return '#e74c3c'; // red
  }
}

/**
 * Canada bounding box for validation
 */
export const CANADA_BOUNDS: BoundingBox = [-141, 42, -52, 84];

/**
 * Check if a bounding box is within Canada
 */
export function isWithinCanada(bounds: BoundingBox): boolean {
  const [minLng, minLat, maxLng, maxLat] = bounds;
  const [caMinLng, caMinLat, caMaxLng, caMaxLat] = CANADA_BOUNDS;
  return minLng >= caMinLng && maxLng <= caMaxLng && minLat >= caMinLat && maxLat <= caMaxLat;
}
