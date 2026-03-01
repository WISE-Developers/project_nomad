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

  return response.json();
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
    type: 'point' | 'polygon';
    /** Point: [lng, lat], Polygon: [[[lng, lat], ...ring positions...]] */
    coordinates: [number, number] | [number, number][][];
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
  outputMode?: 'probabilistic' | 'pseudo-deterministic';
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
    type: 'point' | 'polygon';
    coordinates: [number, number] | [number, number][][];
  };
  timeRange: {
    start: string;
    end: string;
  };
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
  outputMode?: 'probabilistic' | 'pseudo-deterministic';
  /** Model mode - type of fire modeling analysis to perform */
  modelMode?: 'probabilistic' | 'deterministic' | 'long-term-risk';
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
