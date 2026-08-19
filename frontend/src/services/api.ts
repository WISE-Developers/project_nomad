/**
 * API Service
 *
 * HTTP client for backend API communication.
 */

/**
 * Base URL for API requests that need absolute URLs (e.g., tile URLs, downloads).
 * In SAN mode, set VITE_API_BASE_URL in .env at build time.
 * In ACN/embedded mode, the host app provides baseUrl via createDefaultAdapter() —
 * this value is not needed and may be undefined.
 */
import type { ResolvedFuelDataset } from '../shared/utils/fuelVintage';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string | undefined;

/** Relative API path for proxied requests */
const API_BASE = '/api/v1';

/**
 * API error with response details
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Get username header if simple auth is enabled
 */
function getUserHeader(): Record<string, string> {
  const username = localStorage.getItem('nomad_username');
  if (username) {
    return { 'X-Nomad-User': username };
  }
  return {};
}

/**
 * Make an API request
 */
async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const config: RequestInit = {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...getUserHeader(),
      ...options.headers,
    },
  };

  const response = await fetch(url, config);

  if (!response.ok) {
    let details: unknown;
    const text = await response.text();
    try {
      details = JSON.parse(text);
    } catch {
      details = text;
    }
    throw new ApiError(
      `API request failed: ${response.statusText}`,
      response.status,
      details
    );
  }

  const data = await response.json();
  return data;
}

// ============================================================================
// Models API
// ============================================================================

export interface CreateModelRequest {
  name: string;
  engineType: 'firestarr' | 'wise';
}

export interface CreateModelResponse {
  id: string;
  name: string;
  engineType: string;
  status: string;
  createdAt: string;
}

export interface ExecuteModelRequest {
  ignition: {
    type: 'point' | 'polygon' | 'linestring';
    /** Point: [lng, lat], LineString: [[lng, lat], ...], Polygon: [[[lng, lat], ...ring positions...]] */
    coordinates: [number, number] | [number, number][] | [number, number][][];
  };
  timeRange: {
    start: string;
    end: string;
  };
  weather: {
    source: 'firestarr_csv' | 'raw_weather' | 'spotwx';
    /** For firestarr_csv: Pre-calculated weather CSV content */
    firestarrCsvContent?: string;
    /** For raw_weather: Raw weather CSV content (without FWI columns) */
    rawWeatherContent?: string;
    /** For raw_weather: Starting codes for CFFDRS calculation */
    startingCodes?: {
      ffmc: number;
      dmc: number;
      dc: number;
    };
    /** For raw_weather: Latitude for CFFDRS calculation */
    latitude?: number;
  };
  scenarios?: number;
  /** Output mode - how to post-process results */
  outputMode?: 'probabilistic' | 'deterministic';
}

export interface ExecuteModelResponse {
  jobId: string;
  message: string;
}

export interface ModelResponse {
  id: string;
  name: string;
  engineType: string;
  status: string;
  createdAt: string;
  updatedAt?: string;
  userId: string | null;
  outputMode?: string | null;
  durationDays?: number | null;
  notes?: string | null;
}

/**
 * Create a new model
 */
export async function createModel(data: CreateModelRequest): Promise<CreateModelResponse> {
  return request<CreateModelResponse>('/models', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Execute a model
 */
export async function executeModel(
  modelId: string,
  data: ExecuteModelRequest
): Promise<ExecuteModelResponse> {
  return request<ExecuteModelResponse>(`/models/${modelId}/execute`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Get a model by ID
 */
export async function getModel(modelId: string): Promise<ModelResponse> {
  return request<ModelResponse>(`/models/${modelId}`);
}

export interface GetModelsResponse {
  models: ModelResponse[];
  total: number;
}

/**
 * Get all models
 */
export async function getModels(): Promise<GetModelsResponse> {
  return request<GetModelsResponse>('/models');
}

export interface DeleteModelResponse {
  message: string;
  deletedResults: number;
}

/**
 * Delete a model and its results
 */
export async function deleteModel(modelId: string): Promise<DeleteModelResponse> {
  return request<DeleteModelResponse>(`/models/${modelId}`, {
    method: 'DELETE',
  });
}

export interface RunModelRequest {
  name: string;
  engineType: 'firestarr' | 'wise';
  ignition: {
    type: 'point' | 'polygon' | 'linestring';
    coordinates: [number, number] | [number, number][] | [number, number][][];
  };
  timeRange: {
    start: string;
    end: string;
  };
  /** IANA timezone identifier (e.g. "America/Edmonton"). Required by backend. */
  timezone: string;
  weather: {
    source: 'firestarr_csv' | 'raw_weather' | 'spotwx';
    firestarrCsvContent?: string;
    rawWeatherContent?: string;
    startingCodes?: {
      ffmc: number;
      dmc: number;
      dc: number;
    };
    latitude?: number;
  };
  scenarios?: number;
  /** Output mode - how to post-process results */
  outputMode?: 'probabilistic' | 'deterministic';
  /** Model mode - type of fire modeling analysis to perform */
  modelMode?: 'probabilistic' | 'deterministic' | 'long-term-risk';
  /** Optional user-provided notes for this model run */
  notes?: string;
}

export interface RunModelResponse {
  modelId: string;
  jobId: string;
  message: string;
}

/**
 * Create and run a model in one atomic operation (no orphaned drafts)
 */
export async function runModel(data: RunModelRequest): Promise<RunModelResponse> {
  return request<RunModelResponse>('/models/run', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ============================================================================
// Jobs API
// ============================================================================

export interface JobResponse {
  id: string;
  modelId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

/**
 * Get job status
 */
export async function getJob(jobId: string): Promise<JobResponse> {
  return request<JobResponse>(`/jobs/${jobId}`);
}

// ============================================================================
// Config API
// ============================================================================

export interface ConfigResponse {
  deploymentMode: 'SAN' | 'ACN';
  branding: {
    name: string;
    logoUrl: string | null;
    primaryColor: string;
  };
  features: {
    engines: string[];
    exportFormats: string[];
  };
}

/**
 * Get application configuration
 */
export async function getConfig(): Promise<ConfigResponse> {
  return request<ConfigResponse>('/config');
}

// ============================================================================
// Fuel Datasets API (#319)
// ============================================================================

export interface FuelDatasetSummary {
  vintage: number;
  edition?: string;
  label?: string;
  producer?: string;
  provider?: string;
  buildDate?: string;
  resolutionM?: number;
}

export interface FuelDatasetsResponse {
  datasets: FuelDatasetSummary[];
  /** Present only when modelYear was supplied. */
  resolved?: ResolvedFuelDataset;
}

/**
 * Get installed fuel dataset vintages.
 * Pass modelYear to also learn which vintage that year resolves to, including
 * whether fuel lookup fell back to the default dataset.
 */
export async function getFuelDatasets(modelYear?: number): Promise<FuelDatasetsResponse> {
  const query = modelYear === undefined ? '' : `?modelYear=${modelYear}`;
  return request<FuelDatasetsResponse>(`/fuel-datasets${query}`);
}

// ============================================================================
// Notification Preferences API
// ============================================================================

export type NotificationEventType =
  | 'model_completed'
  | 'model_failed'
  | 'import_completed'
  | 'import_failed';

export interface NotificationPreference {
  userId: string;
  eventType: NotificationEventType;
  toastEnabled: boolean;
  browserEnabled: boolean;
}

export interface GetNotificationPreferencesResponse {
  preferences: NotificationPreference[];
}

/**
 * Get all notification preferences for the current user
 */
export async function getNotificationPreferences(): Promise<GetNotificationPreferencesResponse> {
  return request<GetNotificationPreferencesResponse>('/notifications/preferences');
}

export interface UpdateNotificationPreferencesRequest {
  preferences: Array<{
    eventType: NotificationEventType;
    toastEnabled: boolean;
    browserEnabled: boolean;
  }>;
}

/**
 * Update notification preferences for the current user
 */
export async function updateNotificationPreferences(
  data: UpdateNotificationPreferencesRequest
): Promise<GetNotificationPreferencesResponse> {
  return request<GetNotificationPreferencesResponse>('/notifications/preferences', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/**
 * Pre-flight weather inspection — issue #351.
 *
 * Read-only. Detects the daily-only CFFDRS shape and returns the starting codes
 * already present in the user's file. Creates no model and no job, so declining
 * the offer leaves nothing behind to clean up.
 */
export interface PreflightRequest {
  timezone: string;
  timeRange: { start: string; end: string };
  weather: { source: 'firestarr_csv' | 'raw_weather' | 'spotwx'; firestarrCsvContent?: string };
}

export interface PreflightCandidate {
  ffmc: number;
  dmc: number;
  dc: number;
  observedAt: string;
  localLabel: string;
}

export interface PreflightRhythm {
  dailyHour: number;
  hoursFromNoon: number;
  likelyZoneMismatch: boolean;
}

export interface PreflightResponse {
  dailyOnlyCffdrs: boolean;
  candidate: PreflightCandidate | null;
  /** How the file's daily rhythm compares with the timezone contract (#354). */
  rhythm: PreflightRhythm | null;
}

export async function preflightWeather(body: PreflightRequest): Promise<PreflightResponse> {
  return request<PreflightResponse>('/models/preflight', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
