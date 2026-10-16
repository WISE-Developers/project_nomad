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
    // Prefer the server's own explanation over the HTTP status text (#339).
    // The backend now says exactly what is wrong — which noon record is
    // missing, how to fix it — and "API request failed: Bad Request" would
    // throw that away and leave the user with the same opacity as before.
    // The backend nests it as { error: { message } }; some routes return a flat
    // { message }. Verified against the running stack — reading only the flat
    // form silently fell back to "Bad Request".
    const asRecord = (v: unknown): Record<string, unknown> | undefined =>
      v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;

    const body = asRecord(details);
    const nested = asRecord(body?.error);
    const serverMessage = [nested?.message, body?.message].find(
      (m): m is string => typeof m === 'string' && m.length > 0,
    );

    throw new ApiError(
      serverMessage ?? `API request failed: ${response.statusText}`,
      response.status,
      details
    );
  }

  // A 204 has no body, and `response.json()` on an empty body throws
  // "Unexpected end of JSON input" — which would surface as a failure for a
  // request that actually SUCCEEDED. Every endpoint in this client used to
  // return a body, so #315's `DELETE /adhoc-layers/:id` is the first 204 to
  // reach here; its test caught this.
  // Status only. An earlier version also read `content-length`, which broke
  // three preflightWeather tests whose fetch mocks are partial Response
  // objects with no `headers` — a fair signal that the extra check was asking
  // more of a response than this needs. 204 is the case that actually occurs.
  if (response.status === 204) {
    return undefined as T;
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
  /**
   * A single ignition. Kept for existing callers, including the openNomad
   * embedding contract.
   */
  ignition?: {
    type: 'point' | 'polygon' | 'linestring';
    coordinates: [number, number] | [number, number][] | [number, number][][];
  };
  /**
   * Several ignitions, merged server-side into one multi-part geometry
   * (refs #294). Additive, so `ignition` keeps working.
   */
  ignitions?: Array<{
    type: 'point' | 'polygon' | 'linestring';
    coordinates: [number, number] | [number, number][] | [number, number][][];
  }>;
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
  /**
   * What the backend did to the requested ignitions — a point turned into a
   * nominal circle, a line widened into a corridor (refs #294).
   *
   * Empty for a single ignition. These must be shown: a point quietly becoming
   * a 100 m circle is exactly the silence this issue has been removing.
   */
  ignitionNotices?: string[];
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
  /** Dataset year — the model year this dataset serves (#431). */
  datasetYear: number;
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
  /**
   * Every drawn ignition, for the #432 extent check. ALL of them, not the
   * first: the grid has to cover the union, and understating a span is the
   * unsafe direction because the engine crops without saying so.
   */
  ignitions?: Array<{ type: string; coordinates: unknown }>;
}

/** #432 — measured before the run, so the operator still has the choice. */
export interface PreflightExtent {
  /** False when no geometry was supplied. NOT the same as "measured and fine". */
  measured: boolean;
  withinLimit: boolean;
  nearLimit: boolean;
  widthM: number;
  heightM: number;
  /** Present only on a refusal. */
  reason?: string;
  /** Present only on an advisory, where the run proceeds. */
  warning?: string;
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
  /** Optional so an older backend response still parses. */
  extent?: PreflightExtent;
}

export async function preflightWeather(body: PreflightRequest): Promise<PreflightResponse> {
  return request<PreflightResponse>('/models/preflight', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Ad-hoc WMS layers (#315)
//
// Papa's rulings these serve: the user must CHOOSE a layer from the server's
// own catalogue rather than typing its name, and a PRIVATE checkbox decides
// storage — private layers never reach these functions at all, they go to
// `features/Map/adhoc/privateAdhocLayers`. Everything here is SHARED.
//
// Bare endpoints: `request<T>()` already prepends `/api/v1`. Do not confuse
// this client with openNomad's `api.fetch()`, which is a raw passthrough and
// wants full paths.
// ---------------------------------------------------------------------------

export interface AdhocLayerResponse {
  id: string;
  name: string;
  serviceUrl: string;
  layerName: string;
  wmsVersion: string;
  legendUrl: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface ListAdhocLayersResponse {
  layers: AdhocLayerResponse[];
}

export interface CreateAdhocLayerRequest {
  name: string;
  serviceUrl: string;
  layerName: string;
  wmsVersion?: string;
  legendUrl?: string | null;
}

/** One layer as the WMS server publishes it — the chooser's options. */
export interface WmsCatalogueLayer {
  name: string;
  title: string;
  abstract?: string;
  /**
   * The scale range the server will draw this layer at (#448). Absent means
   * unconstrained — which is NOT the same as zero. Outside its range a server
   * returns an empty image with a 200, so without these a layer that cannot
   * draw is indistinguishable from one that worked.
   */
  minScaleDenominator?: number;
  maxScaleDenominator?: number;
}

export interface WmsCapabilitiesResponse {
  version: string;
  layers: WmsCatalogueLayer[];
}

/**
 * Every shared ad-hoc layer on this deployment.
 *
 * Shared means shared: this returns other users' layers too. Hiding one from
 * your own map is local state, held in `privateAdhocLayers`.
 */
export async function listAdhocLayers(): Promise<ListAdhocLayersResponse> {
  return request<ListAdhocLayersResponse>('/adhoc-layers');
}

export async function createAdhocLayer(
  body: CreateAdhocLayerRequest
): Promise<{ layer: AdhocLayerResponse }> {
  return request<{ layer: AdhocLayerResponse }>('/adhoc-layers', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Remove a shared layer for everyone.
 *
 * Creator-only on the server: a non-creator gets 403 `NOT_LAYER_OWNER` with a
 * message naming the owner. That message is worth showing verbatim — it tells
 * the user they can hide the layer instead.
 */
export async function deleteAdhocLayer(id: string): Promise<void> {
  await request<void>(`/adhoc-layers/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/**
 * Read a WMS server's catalogue so the user can choose a layer.
 *
 * The service url is encoded as a query parameter because a WMS url carries
 * its own query string — concatenated raw, its `?` and `&` would merge into
 * ours and the backend would see different parameters than we sent.
 *
 * Refusals arrive as `ApiError` and the caller MUST keep them apart:
 *   502 — could not read the catalogue; what the server publishes is unknown
 *   400 — read it, and it publishes no layers (or it is not a WMS at all)
 * Both carry the server's own wording in `.message`.
 */
export async function fetchWmsCapabilities(
  serviceUrl: string,
  version?: string
): Promise<WmsCapabilitiesResponse> {
  const params = new URLSearchParams({ url: serviceUrl });
  if (version) params.set('version', version);
  return request<WmsCapabilitiesResponse>(`/adhoc-layers/capabilities?${params.toString()}`);
}
