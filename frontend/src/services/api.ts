/**
 * API Service
 *
 * HTTP client for backend API communication.
 */

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
      ...options.headers,
    },
  };

  const response = await fetch(url, config);

  if (!response.ok) {
    let details: unknown;
    try {
      details = await response.json();
    } catch {
      details = await response.text();
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
    coordinates: [number, number] | [number, number][];
  };
  timeRange: {
    start: string;
    end: string;
  };
  weather: {
    source: 'manual' | 'spotwx';
    manual?: {
      ffmc: number;
      dmc: number;
      dc: number;
      windSpeed: number;
      windDirection: number;
      temperature: number;
      humidity: number;
      precipitation?: number;
    };
  };
  scenarios?: number;
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
  updatedAt: string;
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
