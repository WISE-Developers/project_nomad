/**
 * openNomad API Interface
 *
 * This file defines the communication contract between the Dashboard component
 * and backend services. The Dashboard NEVER communicates directly with Nomad
 * services or agency services - all communication flows through this interface.
 *
 * ## Architecture
 *
 * ```
 * Dashboard Component <--> IOpenNomadAPI <--> Backend Services
 * ```
 *
 * ## Implementations
 *
 * - **Default (SAN)**: Ships with Nomad, works out-of-the-box for standalone deployments
 * - **Agency Adapters**: Custom implementations that connect to agency-specific services
 *
 * ## For Agency Implementers
 *
 * To create a custom adapter:
 * 1. Implement the IOpenNomadAPI interface
 * 2. Handle auth token forwarding from your host application
 * 3. Connect to both Nomad services AND your agency-specific services
 * 4. See `/frontend/src/openNomad/default/` for a heavily-commented reference implementation
 *
 * @module openNomad/api
 */

// =============================================================================
// Common Types
// =============================================================================

/**
 * Bounding box as [minLng, minLat, maxLng, maxLat]
 */
export type BBox = [number, number, number, number];

/**
 * GeoJSON geometry types supported by the API
 */
export type GeoJSONGeometry =
  | GeoJSON.Point
  | GeoJSON.LineString
  | GeoJSON.Polygon
  | GeoJSON.MultiPoint
  | GeoJSON.MultiLineString
  | GeoJSON.MultiPolygon;

/**
 * Pagination parameters for list operations
 */
export interface PaginationParams {
  /** Page number (1-indexed) */
  page?: number;
  /** Items per page (default: 20, max: 100) */
  limit?: number;
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  /** The data items for this page */
  data: T[];
  /** Total number of items across all pages */
  total: number;
  /** Current page number */
  page: number;
  /** Items per page */
  limit: number;
  /** Total number of pages */
  totalPages: number;
}

/**
 * Subscription cleanup function
 */
export type Unsubscribe = () => void;

// =============================================================================
// Auth Types
// =============================================================================

/**
 * User information returned by the auth module.
 *
 * In SAN mode, this comes from the local user database.
 * In ACN mode, this is populated from the agency's identity provider.
 */
export interface User {
  /** Unique user identifier */
  id: string;
  /** User's display name */
  name: string;
  /** User's email address */
  email: string;
  /** User's role in the system */
  role: UserRole;
  /** Agency identifier (ACN mode only) */
  agencyId?: string;
  /** URL to user's avatar image */
  avatarUrl?: string;
}

/**
 * User roles from most to least privileged.
 *
 * - **admin**: Full system configuration access
 * - **fban**: Fire Behavior Analyst - all modeling features
 * - **modeler**: Most modeling features
 * - **user**: Simple modeling only
 * - **anonymous**: No modeling access (view only)
 */
export type UserRole = 'admin' | 'fban' | 'modeler' | 'user' | 'anonymous';

// =============================================================================
// Model Types
// =============================================================================

/**
 * Fire modeling engine types.
 *
 * - **firestarr**: FireSTARR probabilistic fire spread model
 * - **wise**: WISE (Wildfire Intelligence and Scenario Engine)
 */
export type EngineType = 'firestarr' | 'wise';

/**
 * Model status throughout its lifecycle.
 *
 * State machine:
 * ```
 * draft -> queued -> running -> completed
 *                          \-> failed
 * ```
 */
export type ModelStatus = 'draft' | 'queued' | 'running' | 'completed' | 'failed';

/**
 * Fire model entity as returned by the API.
 *
 * Represents a fire behavior simulation request with its current status
 * and configuration metadata.
 */
export interface Model {
  /** Unique model identifier (format: NOMAD-YYYYMMDD-XXXXX) */
  id: string;
  /** User-provided name for the model */
  name: string;
  /** Fire modeling engine used */
  engine: EngineType;
  /** Current status in the execution lifecycle */
  status: ModelStatus;
  /** User who created this model */
  userId: string;
  /** ISO 8601 timestamp when model was created */
  createdAt: string;
  /** ISO 8601 timestamp when model was last updated */
  updatedAt: string;
  /** Optional user notes about this model */
  notes?: string;
}

/**
 * Parameters for creating a new model.
 *
 * These map to the wizard steps in the Dashboard:
 * 1. Spatial input (ignition point, line, or perimeter)
 * 2. Temporal parameters (start time, duration)
 * 3. Model selection (engine, output mode)
 * 4. Weather data
 */
export interface ModelCreateParams {
  /** User-provided name for the model */
  name: string;
  /** Fire modeling engine to use */
  engine: EngineType;
  /** Ignition geometry (point, line, or polygon) */
  geometry: GeoJSONGeometry;
  /** Temporal parameters for the simulation */
  temporal: TemporalParams;
  /** Weather configuration */
  weather: WeatherParams;
  /** Output configuration */
  output?: OutputParams;
  /** Optional user notes */
  notes?: string;
}

/**
 * Temporal parameters for model execution.
 */
export interface TemporalParams {
  /** Start date in YYYY-MM-DD format */
  startDate: string;
  /** Start time in HH:mm format (24-hour) */
  startTime: string;
  /** Simulation duration in hours (1-720) */
  durationHours: number;
  /** IANA timezone identifier (e.g., "America/Edmonton") */
  timezone: string;
}

/**
 * Weather data configuration for model execution.
 */
export interface WeatherParams {
  /** Weather data source type */
  source: 'csv' | 'spotwx' | 'station';
  /** CSV file content (base64 encoded) for csv source */
  csvData?: string;
  /** SpotWX forecast location for spotwx source */
  spotwxLocation?: { lat: number; lng: number };
  /** Weather station ID for station source */
  stationId?: string;
  /** Starting FWI codes for progressive calculation */
  startingCodes?: FWIStartingCodes;
}

/**
 * FWI starting codes for progressive CFFDRS calculation.
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
 * Output configuration for model execution.
 */
export interface OutputParams {
  /** Output mode: probabilistic (default) or pseudo-deterministic */
  mode: 'probabilistic' | 'pseudo-deterministic';
  /** Confidence interval for pseudo-deterministic perimeters (0.1-0.9) */
  confidenceInterval?: number;
  /** Whether to smooth perimeter polygons */
  smoothPerimeter?: boolean;
}

/**
 * Filter parameters for listing models.
 */
export interface ModelFilter {
  /** Filter by status */
  status?: ModelStatus | ModelStatus[];
  /** Filter by engine type */
  engine?: EngineType;
  /** Filter by date range (ISO 8601) */
  createdAfter?: string;
  /** Filter by date range (ISO 8601) */
  createdBefore?: string;
  /** Filter by spatial bounds (models intersecting this bbox) */
  bounds?: BBox;
  /** Search by name (partial match) */
  search?: string;
}

// =============================================================================
// Job Types
// =============================================================================

/**
 * Job status throughout execution lifecycle.
 *
 * State machine:
 * ```
 * pending -> running -> completed
 *                   \-> failed
 *        \-> cancelled
 * ```
 */
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Job entity representing a model execution request.
 *
 * Jobs track the lifecycle of model execution, from queueing
 * through completion or failure.
 */
export interface Job {
  /** Unique job identifier */
  id: string;
  /** Reference to the model being executed */
  modelId: string;
  /** Current job status */
  status: JobStatus;
  /** Execution progress (0-100) */
  progress: number;
  /** ISO 8601 timestamp when job was queued */
  createdAt: string;
  /** ISO 8601 timestamp when execution started */
  startedAt?: string;
  /** ISO 8601 timestamp when execution completed */
  completedAt?: string;
  /** Error message if job failed */
  error?: string;
  /** IDs of results produced by this job */
  resultIds: string[];
}

/**
 * Detailed job status including progress information.
 */
export interface JobStatusDetail extends Job {
  /** Current execution phase description */
  phase?: string;
  /** Estimated time remaining in seconds */
  estimatedTimeRemaining?: number;
  /** Log messages from execution */
  logs?: string[];
}

// =============================================================================
// Result Types
// =============================================================================

/**
 * Types of output produced by fire models.
 */
export type OutputType =
  | 'probability'        // Burn probability raster (0-1)
  | 'perimeter'          // Fire perimeter polygon
  | 'intensity'          // Fire intensity grid (kW/m)
  | 'rate_of_spread'     // Rate of spread grid (m/min)
  | 'flame_length'       // Flame length grid (m)
  | 'arrival_time'       // Arrival time grid (hours)
  | 'crown_fraction_burned'; // Crown fraction burned (0-1)

/**
 * Model result entity representing an output from fire model execution.
 */
export interface ModelResult {
  /** Unique result identifier */
  id: string;
  /** Reference to the parent model */
  modelId: string;
  /** Type of output this represents */
  outputType: OutputType;
  /** Display name for this result */
  displayName: string;
  /** ISO 8601 timestamp when result was created */
  createdAt: string;
  /** Result metadata */
  metadata: ResultMetadata;
}

/**
 * Metadata about a model result.
 */
export interface ResultMetadata {
  /** Time offset from simulation start (hours) */
  timeOffsetHours?: number;
  /** Simulation date for this output */
  simulationDate?: string;
  /** Probability threshold used (for perimeters derived from probability) */
  probabilityThreshold?: number;
  /** Coordinate reference system (EPSG code) */
  crs?: string;
  /** Resolution in meters (for raster outputs) */
  resolution?: number;
  /** Area in hectares */
  areaHectares?: number;
  /** Statistics about the output */
  statistics?: {
    min?: number;
    max?: number;
    mean?: number;
    stdDev?: number;
  };
}

/**
 * Collection of all results from a model execution.
 */
export interface ModelResults {
  /** The model these results belong to */
  model: Model;
  /** All result outputs */
  results: ModelResult[];
  /** Summary statistics */
  summary: {
    /** Total area burned (hectares) */
    totalAreaHa?: number;
    /** Maximum spread distance (km) */
    maxSpreadKm?: number;
    /** Simulation duration (hours) */
    durationHours: number;
  };
}

/**
 * Export format options.
 */
export interface ExportFormat {
  /** Format identifier */
  id: string;
  /** Human-readable format name */
  name: string;
  /** File extension */
  extension: string;
  /** Category of format */
  category: 'vector' | 'raster';
  /** Output types this format supports */
  supportedOutputTypes: OutputType[];
}

/**
 * Export request parameters.
 */
export interface ExportParams {
  /** Result IDs to export (empty = all results) */
  resultIds?: string[];
  /** Target format for export */
  format: string;
  /** Whether to include raw model inputs */
  includeInputs?: boolean;
}

// =============================================================================
// Spatial Types
// =============================================================================

/**
 * Draw mode for map geometry input.
 */
export type DrawMode = 'point' | 'line' | 'polygon';

/**
 * Map layer for displaying results or reference data.
 */
export interface MapLayer {
  /** Unique layer identifier */
  id: string;
  /** Layer type */
  type: 'geojson' | 'raster' | 'vector-tile';
  /** GeoJSON data for geojson type */
  data?: GeoJSON.FeatureCollection | GeoJSON.Feature | GeoJSON.Geometry;
  /** URL for raster or vector-tile types */
  url?: string;
  /** Layer styling */
  style?: MapLayerStyle;
  /** Z-order (higher = on top) */
  zIndex?: number;
  /** Layer visibility */
  visible?: boolean;
}

/**
 * Styling options for map layers.
 */
export interface MapLayerStyle {
  /** Fill color for polygons (hex or rgba) */
  fillColor?: string;
  /** Fill opacity (0-1) */
  fillOpacity?: number;
  /** Stroke/line color (hex or rgba) */
  strokeColor?: string;
  /** Stroke width in pixels */
  strokeWidth?: number;
  /** Stroke opacity (0-1) */
  strokeOpacity?: number;
  /** Point radius in pixels */
  pointRadius?: number;
  /** Point color (hex or rgba) */
  pointColor?: string;
}

/**
 * Weather station information.
 */
export interface WeatherStation {
  /** Station identifier */
  id: string;
  /** Station name */
  name: string;
  /** Station coordinates */
  coordinates: { lat: number; lng: number };
  /** Data availability period */
  dataAvailability?: {
    /** ISO 8601 date of earliest data */
    from: string;
    /** ISO 8601 date of latest data */
    to: string;
  };
  /** Station elevation in meters */
  elevationM?: number;
  /** Agency operating this station */
  agency?: string;
}

/**
 * Fuel type data for a region.
 */
export interface FuelTypeData {
  /** Bounding box of the data */
  bounds: BBox;
  /** Available fuel type codes in this region */
  fuelTypes: FuelType[];
  /** URL to WMS/WCS service for fuel type imagery */
  serviceUrl?: string;
  /** Layer name for WMS/WCS */
  layerName?: string;
}

/**
 * Fuel type definition.
 */
export interface FuelType {
  /** Fuel type code (e.g., "C-2", "M-1/M-2") */
  code: string;
  /** Full name of fuel type */
  name: string;
  /** Description of fuel type */
  description?: string;
  /** Display color (hex) */
  color: string;
}

/**
 * Elevation data for a region.
 */
export interface ElevationData {
  /** Bounding box of the data */
  bounds: BBox;
  /** URL to elevation service */
  serviceUrl: string;
  /** Resolution in meters */
  resolutionM: number;
  /** Elevation range in the bounds */
  elevationRange?: {
    min: number;
    max: number;
  };
}

// =============================================================================
// Config Types
// =============================================================================

/**
 * Fire modeling engine configuration.
 */
export interface Engine {
  /** Engine identifier */
  id: EngineType;
  /** Engine display name */
  name: string;
  /** Engine description */
  description: string;
  /** Whether this engine is currently available */
  available: boolean;
  /** Capabilities of this engine */
  capabilities: {
    /** Supports probabilistic output */
    probabilistic: boolean;
    /** Supports deterministic output */
    deterministic: boolean;
    /** Supports polygon ignition */
    polygonIgnition: boolean;
    /** Supports line ignition */
    lineIgnition: boolean;
    /** Maximum simulation duration (hours) */
    maxDurationHours: number;
  };
}

/**
 * Agency-specific configuration.
 */
export interface AgencyConfig {
  /** Agency identifier */
  id: string;
  /** Agency display name */
  name: string;
  /** Agency logo URL */
  logoUrl?: string;
  /** Agency branding colors */
  branding?: {
    primaryColor: string;
    secondaryColor: string;
  };
  /** Default map center for this agency */
  defaultMapCenter?: { lat: number; lng: number; zoom: number };
  /** Available export formats for this agency */
  exportFormats: ExportFormat[];
  /** Contact information */
  contact?: {
    name: string;
    email: string;
  };
}

// =============================================================================
// API Interface
// =============================================================================

/**
 * The openNomad API interface that all adapters must implement.
 *
 * This is the communication contract between the Dashboard and backend services.
 * The Dashboard calls these methods; implementations connect to the appropriate
 * services based on deployment mode (SAN vs ACN).
 *
 * ## Sections
 *
 * - **auth**: User authentication (receives from host, doesn't implement protocols)
 * - **models**: Fire model CRUD operations
 * - **jobs**: Job submission and monitoring
 * - **results**: Result retrieval and export
 * - **spatial**: Spatial data services (weather stations, fuel types, elevation)
 * - **config**: System configuration
 *
 * @example
 * ```typescript
 * // Using the API in a component
 * const api = useOpenNomad();
 *
 * // List user's models
 * const models = await api.models.list({ status: 'completed' });
 *
 * // Submit a new job
 * const job = await api.jobs.submit(modelId);
 *
 * // Subscribe to status changes
 * const unsubscribe = api.jobs.onStatusChange(job.id, (status) => {
 *   console.log('Job status:', status.status);
 * });
 * ```
 */
export interface IOpenNomadAPI {
  // ===========================================================================
  // Auth Module
  // ===========================================================================

  /**
   * Authentication operations.
   *
   * In ACN mode, auth is handled by the host application.
   * The adapter receives tokens and forwards them to Nomad services.
   */
  auth: {
    /**
     * Get the currently authenticated user.
     *
     * @returns The current user, or null if not authenticated
     */
    getCurrentUser(): Promise<User | null>;

    /**
     * Get the current auth token for API calls.
     *
     * In ACN mode, this returns the token provided by the host application.
     * In SAN mode, this returns the token from local auth.
     *
     * @returns The auth token, or null if not authenticated
     */
    getAuthToken(): Promise<string | null>;

    /**
     * Subscribe to authentication state changes.
     *
     * @param callback - Called when auth state changes
     * @returns Cleanup function to unsubscribe
     */
    onAuthChange(callback: (user: User | null) => void): Unsubscribe;
  };

  // ===========================================================================
  // Models Module
  // ===========================================================================

  /**
   * Fire model operations.
   */
  models: {
    /**
     * Create a new fire model.
     *
     * @param params - Model creation parameters
     * @returns The created model
     */
    create(params: ModelCreateParams): Promise<Model>;

    /**
     * List models for the current user.
     *
     * @param filter - Optional filter criteria
     * @param pagination - Optional pagination parameters
     * @returns Paginated list of models
     */
    list(filter?: ModelFilter, pagination?: PaginationParams): Promise<PaginatedResponse<Model>>;

    /**
     * Get a specific model by ID.
     *
     * @param id - Model ID
     * @returns The model
     * @throws NotFoundError if model doesn't exist
     */
    get(id: string): Promise<Model>;

    /**
     * Update a model (only allowed for draft models).
     *
     * @param id - Model ID
     * @param updates - Partial model updates
     * @returns The updated model
     * @throws NotFoundError if model doesn't exist
     * @throws ValidationError if model is not in draft status
     */
    update(id: string, updates: Partial<ModelCreateParams>): Promise<Model>;

    /**
     * Delete a model and all associated data.
     *
     * @param id - Model ID
     * @throws NotFoundError if model doesn't exist
     */
    delete(id: string): Promise<void>;

    /**
     * Get the current status of a model.
     *
     * @param id - Model ID
     * @returns The model status
     */
    getStatus(id: string): Promise<ModelStatus>;
  };

  // ===========================================================================
  // Jobs Module
  // ===========================================================================

  /**
   * Job execution operations.
   */
  jobs: {
    /**
     * Submit a model for execution.
     *
     * @param modelId - ID of the model to execute
     * @returns The created job
     * @throws NotFoundError if model doesn't exist
     * @throws ValidationError if model cannot be executed
     */
    submit(modelId: string): Promise<Job>;

    /**
     * Cancel a running or pending job.
     *
     * @param jobId - Job ID
     * @throws NotFoundError if job doesn't exist
     * @throws ValidationError if job cannot be cancelled
     */
    cancel(jobId: string): Promise<void>;

    /**
     * Get detailed job status.
     *
     * @param jobId - Job ID
     * @returns Detailed job status including progress info
     */
    getStatus(jobId: string): Promise<JobStatusDetail>;

    /**
     * Subscribe to job status changes.
     *
     * Uses WebSocket or polling depending on availability.
     *
     * @param jobId - Job ID to monitor
     * @param callback - Called when job status changes
     * @returns Cleanup function to unsubscribe
     */
    onStatusChange(jobId: string, callback: (status: JobStatusDetail) => void): Unsubscribe;
  };

  // ===========================================================================
  // Results Module
  // ===========================================================================

  /**
   * Result retrieval and export operations.
   */
  results: {
    /**
     * Get all results for a model.
     *
     * @param modelId - Model ID
     * @returns Model results collection
     * @throws NotFoundError if model doesn't exist
     */
    get(modelId: string): Promise<ModelResults>;

    /**
     * Get a specific result's data (GeoJSON or raster URL).
     *
     * @param resultId - Result ID
     * @returns GeoJSON for vector results, or URL for raster results
     */
    getData(resultId: string): Promise<GeoJSONGeometry | string>;

    /**
     * Export model results in a specific format.
     *
     * @param modelId - Model ID
     * @param params - Export parameters
     * @returns Blob containing the exported data (typically a ZIP file)
     */
    export(modelId: string, params: ExportParams): Promise<Blob>;

    /**
     * Get available export formats.
     *
     * @returns List of available export formats
     */
    getExportFormats(): Promise<ExportFormat[]>;
  };

  // ===========================================================================
  // Spatial Module
  // ===========================================================================

  /**
   * Spatial data and map interaction services.
   *
   * This module serves two purposes:
   * 1. **Data Services**: Access to weather stations, fuel types, and elevation data
   * 2. **Map Interaction**: Drawing geometry, managing layers, and map navigation
   *
   * In ACN mode, the host application implements these using its own map component.
   * In SAN mode, Nomad's built-in map handles the implementation.
   *
   * This is the key abstraction that enables embedding - Nomad declares what
   * spatial capabilities it needs, and the host provides the implementation.
   */
  spatial: {
    // -------------------------------------------------------------------------
    // Map Interaction (Host-Provided in ACN Mode)
    // -------------------------------------------------------------------------

    /**
     * Request user to draw a point on the map.
     *
     * The host application activates its point drawing tool and returns
     * the result when the user completes the action.
     *
     * @returns The drawn point geometry
     * @throws If user cancels or drawing is not available
     */
    drawPoint(): Promise<GeoJSON.Point>;

    /**
     * Request user to draw a line on the map.
     *
     * The host application activates its line drawing tool and returns
     * the result when the user completes the action.
     *
     * @returns The drawn line geometry
     * @throws If user cancels or drawing is not available
     */
    drawLine(): Promise<GeoJSON.LineString>;

    /**
     * Request user to draw a polygon on the map.
     *
     * The host application activates its polygon drawing tool and returns
     * the result when the user completes the action.
     *
     * @returns The drawn polygon geometry
     * @throws If user cancels or drawing is not available
     */
    drawPolygon(): Promise<GeoJSON.Polygon>;

    /**
     * Subscribe to geometry changes during drawing.
     *
     * Called repeatedly as the user draws, allowing real-time preview.
     * Useful for showing area calculations, validation feedback, etc.
     *
     * @param callback - Called with the current geometry state
     * @returns Cleanup function to unsubscribe
     */
    onGeometryChange(callback: (geometry: GeoJSONGeometry | null) => void): Unsubscribe;

    /**
     * Cancel any active drawing operation.
     *
     * Deactivates the drawing tool without returning geometry.
     */
    cancelDraw(): void;

    /**
     * Add a layer to the map.
     *
     * Used for displaying model results, reference data, etc.
     *
     * @param layer - Layer configuration
     */
    addLayer(layer: MapLayer): void;

    /**
     * Update an existing layer.
     *
     * @param id - Layer ID to update
     * @param updates - Partial layer updates
     */
    updateLayer(id: string, updates: Partial<MapLayer>): void;

    /**
     * Remove a layer from the map.
     *
     * @param id - Layer ID to remove
     */
    removeLayer(id: string): void;

    /**
     * Fit the map view to a bounding box.
     *
     * @param bounds - Bounding box to fit
     * @param options - Optional padding and animation settings
     */
    fitBounds(bounds: BBox, options?: { padding?: number; animate?: boolean }): void;

    /**
     * Get the current map bounds.
     *
     * @returns Current visible bounds
     */
    getBounds(): BBox;

    // -------------------------------------------------------------------------
    // Data Services
    // -------------------------------------------------------------------------

    /**
     * Get weather stations within bounds.
     *
     * @param bounds - Bounding box to search
     * @returns Weather stations in the area
     */
    getWeatherStations(bounds: BBox): Promise<WeatherStation[]>;

    /**
     * Get fuel type data for a region.
     *
     * @param bounds - Bounding box to query
     * @returns Fuel type data including WMS/WCS service info
     */
    getFuelTypes(bounds: BBox): Promise<FuelTypeData>;

    /**
     * Get elevation data for a region.
     *
     * @param bounds - Bounding box to query
     * @returns Elevation data including service URL
     */
    getElevation(bounds: BBox): Promise<ElevationData>;
  };

  // ===========================================================================
  // Config Module
  // ===========================================================================

  /**
   * System configuration.
   */
  config: {
    /**
     * Get available fire modeling engines.
     *
     * @returns List of available engines with their capabilities
     */
    getAvailableEngines(): Promise<Engine[]>;

    /**
     * Get agency-specific configuration.
     *
     * In SAN mode, returns generic Nomad configuration.
     * In ACN mode, returns agency-specific branding and settings.
     *
     * @returns Agency configuration
     */
    getAgencyConfig(): Promise<AgencyConfig>;
  };
}
