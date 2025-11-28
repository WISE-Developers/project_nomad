/**
 * ModelReview Types
 *
 * Types for model results and output display.
 */

/**
 * Output types from fire modeling engines
 */
export type OutputType =
  | 'burn_probability'
  | 'fire_intensity'
  | 'arrival_time'
  | 'fire_perimeter'
  | 'ember_density'
  | 'weather_grid'
  | 'fuel_grid';

/**
 * Output file formats
 */
export type OutputFormat = 'geotiff' | 'geojson' | 'kml' | 'csv' | 'shapefile';

/**
 * Execution status states
 */
export type ExecutionState =
  | 'queued'
  | 'initializing'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Summary of model execution
 */
export interface ExecutionSummary {
  startedAt: string | null;
  completedAt: string | null;
  durationSeconds: number | null;
  simulationCount?: number;
  status: ExecutionState;
  progress: number;
  error?: string;
}

/**
 * Single output item from model results
 */
export interface OutputItem {
  id: string;
  type: OutputType;
  format: OutputFormat;
  name: string;
  timeOffsetHours: number | null;
  filePath: string | null;
  previewUrl: string;
  downloadUrl: string;
  metadata: Record<string, unknown>;
}

/**
 * Full model results response from API
 */
export interface ModelResultsResponse {
  modelId: string;
  modelName: string;
  engineType: string;
  executionSummary: ExecutionSummary;
  outputs: OutputItem[];
}

/**
 * Preview data types
 */
export interface ContourFeatureProperties {
  probability: number;
  color: string;
  label: string;
  mock?: boolean;
}

/**
 * State for model review panel
 */
export interface ModelReviewState {
  modelId: string | null;
  isLoading: boolean;
  error: string | null;
  results: ModelResultsResponse | null;
  selectedOutput: OutputItem | null;
  showPreviewModal: boolean;
}

/**
 * Actions for model review
 */
export type ModelReviewAction =
  | { type: 'SET_MODEL_ID'; payload: string }
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; payload: ModelResultsResponse }
  | { type: 'FETCH_ERROR'; payload: string }
  | { type: 'SELECT_OUTPUT'; payload: OutputItem }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'SHOW_PREVIEW' }
  | { type: 'HIDE_PREVIEW' }
  | { type: 'RESET' };
