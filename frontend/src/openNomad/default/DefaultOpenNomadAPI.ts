/**
 * Default openNomad API Implementation (SAN Mode)
 *
 * This is the default adapter that ships with Nomad for Stand Alone (SAN) deployments.
 * It wraps the Nomad backend API and provides the standard openNomad interface.
 *
 * ## For Agency Implementers
 *
 * This file serves as a **template** for creating agency-specific adapters.
 * Each method is heavily commented to explain:
 * - What the method should do
 * - What an agency adapter might do differently
 * - Common customization points
 *
 * To create your own adapter:
 * 1. Copy this file as a starting point
 * 2. Replace the HTTP calls with your agency's API calls
 * 3. Map your agency's data types to the openNomad types
 * 4. Handle agency-specific authentication
 *
 * @module openNomad/default
 */

import type {
  IOpenNomadAPI,
  User,
  UserRole,
  Model,
  ModelStatus,
  ModelCreateParams,
  ModelFilter,
  PaginationParams,
  PaginatedResponse,
  Job,
  JobStatusDetail,
  ModelResults,
  ModelResult,
  ExportFormat,
  ExportParams,
  MapLayer,
  WeatherStation,
  FuelTypeData,
  ElevationData,
  Engine,
  AgencyConfig,
  Unsubscribe,
  BBox,
  GeoJSONGeometry,
  EngineType,
} from '../api.js';

import {
  getModels,
  getModel,
  deleteModel as apiDeleteModel,
  getJob,
  getConfig,
  type ModelResponse,
  type JobResponse,
} from '../../services/api.js';

// =============================================================================
// Type Mapping Utilities
// =============================================================================

/**
 * Map backend ModelResponse to openNomad Model type.
 *
 * AGENCY NOTE: Your backend likely has different field names or additional
 * fields. Adjust this mapping to match your agency's model schema.
 */
function mapModelResponse(response: ModelResponse): Model {
  return {
    id: response.id,
    name: response.name,
    engine: response.engineType as EngineType,
    status: response.status as ModelStatus,
    userId: response.userId ?? 'anonymous',
    createdAt: response.createdAt,
    updatedAt: response.updatedAt ?? response.createdAt,
    notes: undefined, // Backend doesn't store notes yet
  };
}

/**
 * Map backend JobResponse to openNomad Job type.
 *
 * AGENCY NOTE: Adjust field mapping for your agency's job tracking system.
 */
function mapJobResponse(response: JobResponse): Job {
  return {
    id: response.id,
    modelId: response.modelId,
    status: response.status,
    progress: response.progress,
    createdAt: response.createdAt,
    startedAt: response.startedAt,
    completedAt: response.completedAt,
    error: response.error,
    resultIds: [], // Backend doesn't return result IDs in job response
  };
}

/**
 * Map backend JobResponse to openNomad JobStatusDetail type.
 *
 * AGENCY NOTE: If your job system provides phase info or ETAs, map them here.
 */
function mapJobStatusDetail(response: JobResponse): JobStatusDetail {
  return {
    ...mapJobResponse(response),
    phase: response.status === 'running' ? 'Executing model...' : undefined,
    estimatedTimeRemaining: undefined, // Backend doesn't provide ETA
    logs: undefined, // Backend doesn't expose logs via API
  };
}

// =============================================================================
// Subscription Management
// =============================================================================

/**
 * Active polling subscriptions for job status.
 *
 * AGENCY NOTE: If your backend supports WebSocket or SSE for real-time updates,
 * replace polling with a persistent connection for better performance.
 */
const jobSubscriptions = new Map<string, {
  callbacks: Set<(status: JobStatusDetail) => void>;
  intervalId: ReturnType<typeof setInterval>;
}>();

/**
 * Polling interval for job status (milliseconds).
 *
 * AGENCY NOTE: Adjust based on your backend capabilities and network conditions.
 * Consider using exponential backoff for completed/failed jobs.
 */
const JOB_POLL_INTERVAL = 3000;

// =============================================================================
// Default Adapter Factory
// =============================================================================

/**
 * Options for creating the default adapter.
 *
 * AGENCY NOTE: Add your agency-specific configuration options here.
 * Examples: authToken, agencyId, backendUrl, etc.
 */
export interface DefaultAdapterOptions {
  /**
   * Override the API base URL.
   * Default: Uses the configured Vite environment variable.
   *
   * AGENCY NOTE: Your adapter would typically accept the agency backend URL here.
   */
  baseUrl?: string;
}

/**
 * Creates the default openNomad API adapter for SAN mode.
 *
 * This adapter wraps the Nomad backend API and provides full functionality
 * for standalone deployments. It serves as both:
 * 1. The production adapter for SAN mode
 * 2. A heavily-commented template for agency adapters
 *
 * @param options - Optional configuration
 * @returns An implementation of IOpenNomadAPI
 *
 * @example
 * ```tsx
 * import { createDefaultAdapter } from '@/openNomad/default';
 * import { OpenNomadProvider } from '@/openNomad/context';
 *
 * function App() {
 *   const adapter = useMemo(() => createDefaultAdapter(), []);
 *
 *   return (
 *     <OpenNomadProvider adapter={adapter}>
 *       <YourApp />
 *     </OpenNomadProvider>
 *   );
 * }
 * ```
 */
export function createDefaultAdapter(options?: DefaultAdapterOptions): IOpenNomadAPI {
  // Use provided baseUrl, fallback to env var, then localhost for development
  const baseUrl = options?.baseUrl ??
    ((typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) ||
    'http://localhost:3001');

  return {
    // =========================================================================
    // Auth Module
    // =========================================================================

    /**
     * Authentication operations.
     *
     * AGENCY NOTE: This is the most critical module to customize.
     * Your adapter should:
     * 1. Receive auth tokens from the host application (not implement login)
     * 2. Validate tokens with your IdP if needed
     * 3. Map agency roles to Nomad roles (admin/fban/modeler/user/anonymous)
     */
    auth: {
      /**
       * Get the current authenticated user.
       *
       * DEFAULT BEHAVIOR: Reads from localStorage (simple auth mode).
       *
       * AGENCY NOTE: Your adapter should:
       * - Get user info from the auth context passed by the host
       * - Or call your agency's user info endpoint
       * - Map agency roles to Nomad roles
       */
      async getCurrentUser(): Promise<User | null> {
        // In SAN mode, we use simple localStorage-based auth
        const username = localStorage.getItem('nomad_username');

        if (!username) {
          return null;
        }

        // Simple auth doesn't have real user management
        // In production SAN, this would come from a user database
        return {
          id: username,
          name: username,
          email: `${username}@localhost`,
          role: 'fban' as UserRole, // Default to FBAN for simple auth
          agencyId: undefined,
          avatarUrl: undefined,
        };
      },

      /**
       * Get the current auth token for API calls.
       *
       * DEFAULT BEHAVIOR: Returns null (simple auth uses username header).
       *
       * AGENCY NOTE: Return the OAuth/SAML token that your backend expects.
       * The Dashboard will include this in API requests.
       */
      async getAuthToken(): Promise<string | null> {
        // Simple auth doesn't use tokens - it uses X-Nomad-User header
        // In production, this would return a JWT or session token
        return null;
      },

      /**
       * Subscribe to authentication state changes.
       *
       * DEFAULT BEHAVIOR: Watches localStorage for username changes.
       *
       * AGENCY NOTE: Subscribe to your auth context's state changes.
       * Fire the callback when the user logs in/out or their session expires.
       */
      onAuthChange(callback: (user: User | null) => void): Unsubscribe {
        // Watch for storage events (user logging in/out in another tab)
        const handler = (event: StorageEvent) => {
          if (event.key === 'nomad_username') {
            // Re-fetch user when username changes
            this.getCurrentUser().then(callback);
          }
        };

        window.addEventListener('storage', handler);

        return () => {
          window.removeEventListener('storage', handler);
        };
      },
    },

    // =========================================================================
    // Models Module
    // =========================================================================

    /**
     * Fire model operations.
     *
     * AGENCY NOTE: Your adapter connects to your model storage system.
     * You may need to:
     * - Add agency-specific fields (project codes, incident IDs)
     * - Filter models by agency permissions
     * - Route to different backends based on model type
     */
    models: {
      /**
       * Create a new fire model.
       *
       * DEFAULT BEHAVIOR: NOT IMPLEMENTED - uses runModel() atomic operation.
       *
       * AGENCY NOTE: Implement if your backend supports creating drafts.
       * Otherwise, use jobs.submit() for atomic create+execute.
       */
      async create(_params: ModelCreateParams): Promise<Model> {
        // The default backend uses atomic runModel() operation
        // Creating drafts is not supported in the current API
        throw new Error(
          'create() is not implemented in the default adapter. ' +
          'Use jobs.submit() for atomic model creation and execution.'
        );
      },

      /**
       * List models for the current user.
       *
       * DEFAULT BEHAVIOR: Fetches from /api/v1/models endpoint.
       *
       * AGENCY NOTE: Apply agency-specific filters (e.g., by region, project).
       * You may need to merge data from multiple sources.
       */
      async list(
        filter?: ModelFilter,
        pagination?: PaginationParams
      ): Promise<PaginatedResponse<Model>> {
        // Fetch all models from backend
        const response = await getModels();

        // Map to openNomad types
        let models = response.models.map(mapModelResponse);

        // Apply client-side filtering
        // AGENCY NOTE: Ideally filters should be applied server-side
        if (filter) {
          if (filter.status) {
            const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
            models = models.filter(m => statuses.includes(m.status));
          }
          if (filter.engine) {
            models = models.filter(m => m.engine === filter.engine);
          }
          if (filter.search) {
            const search = filter.search.toLowerCase();
            models = models.filter(m => m.name.toLowerCase().includes(search));
          }
          // Note: createdAfter, createdBefore, bounds filters not implemented
        }

        // Apply pagination
        const page = pagination?.page ?? 1;
        const limit = pagination?.limit ?? 20;
        const startIndex = (page - 1) * limit;
        const paginatedModels = models.slice(startIndex, startIndex + limit);

        return {
          data: paginatedModels,
          total: models.length,
          page,
          limit,
          totalPages: Math.ceil(models.length / limit),
        };
      },

      /**
       * Get a specific model by ID.
       *
       * DEFAULT BEHAVIOR: Fetches from /api/v1/models/:id endpoint.
       *
       * AGENCY NOTE: May need to check permissions before returning.
       */
      async get(id: string): Promise<Model> {
        const response = await getModel(id);
        return mapModelResponse(response);
      },

      /**
       * Update a model (only allowed for draft models).
       *
       * DEFAULT BEHAVIOR: NOT IMPLEMENTED.
       *
       * AGENCY NOTE: Implement if your backend supports model updates.
       */
      async update(_id: string, _updates: Partial<ModelCreateParams>): Promise<Model> {
        throw new Error('update() is not implemented in the default adapter.');
      },

      /**
       * Delete a model and all associated data.
       *
       * DEFAULT BEHAVIOR: Calls DELETE /api/v1/models/:id endpoint.
       *
       * AGENCY NOTE: May need additional cleanup (agency storage, notifications).
       */
      async delete(id: string): Promise<void> {
        await apiDeleteModel(id);
      },

      /**
       * Get the current status of a model.
       *
       * DEFAULT BEHAVIOR: Fetches model and returns its status.
       *
       * AGENCY NOTE: For real-time status, consider using jobs.onStatusChange().
       */
      async getStatus(id: string): Promise<ModelStatus> {
        const model = await this.get(id);
        return model.status;
      },
    },

    // =========================================================================
    // Jobs Module
    // =========================================================================

    /**
     * Job execution operations.
     *
     * AGENCY NOTE: Your adapter manages job lifecycle.
     * Consider:
     * - Queue prioritization based on agency policies
     * - Resource allocation (which compute nodes to use)
     * - Job cancellation and cleanup
     */
    jobs: {
      /**
       * Submit a model for execution.
       *
       * DEFAULT BEHAVIOR: NOT DIRECTLY IMPLEMENTED.
       * The default flow uses runModel() atomic operation from services/api.ts.
       *
       * AGENCY NOTE: Your implementation might:
       * - Validate model parameters against agency rules
       * - Route to different compute clusters
       * - Create audit records
       */
      async submit(_modelId: string): Promise<Job> {
        // The default backend uses atomic runModel() operation
        // which creates and executes in one call.
        // This method would be used if we had separate create/execute
        throw new Error(
          'submit() is not directly supported. ' +
          'Model execution happens via the wizard completing the atomic run operation.'
        );
      },

      /**
       * Cancel a running or pending job.
       *
       * DEFAULT BEHAVIOR: NOT IMPLEMENTED.
       *
       * AGENCY NOTE: Implement job cancellation for your compute backend.
       */
      async cancel(_jobId: string): Promise<void> {
        throw new Error('cancel() is not implemented in the default adapter.');
      },

      /**
       * Get detailed job status.
       *
       * DEFAULT BEHAVIOR: Fetches from /api/v1/jobs/:id endpoint.
       *
       * AGENCY NOTE: May include additional agency-specific status info.
       */
      async getStatus(jobId: string): Promise<JobStatusDetail> {
        const response = await getJob(jobId);
        return mapJobStatusDetail(response);
      },

      /**
       * Subscribe to job status changes.
       *
       * DEFAULT BEHAVIOR: Polls the job status endpoint every 3 seconds.
       *
       * AGENCY NOTE: If your backend supports WebSocket or SSE, use those
       * for real-time updates instead of polling. This is more efficient
       * and provides lower latency.
       *
       * @example WebSocket implementation
       * ```typescript
       * onStatusChange(jobId: string, callback): Unsubscribe {
       *   const ws = new WebSocket(`wss://api.agency.gov/jobs/${jobId}/stream`);
       *   ws.onmessage = (event) => {
       *     callback(JSON.parse(event.data));
       *   };
       *   return () => ws.close();
       * }
       * ```
       */
      onStatusChange(
        jobId: string,
        callback: (status: JobStatusDetail) => void
      ): Unsubscribe {
        // Check if we already have a subscription for this job
        let subscription = jobSubscriptions.get(jobId);

        if (!subscription) {
          // Create new subscription with polling
          const callbacks = new Set<(status: JobStatusDetail) => void>();

          const poll = async () => {
            try {
              const status = await this.getStatus(jobId);
              // Notify all callbacks
              callbacks.forEach(cb => cb(status));

              // Stop polling if job is terminal
              if (status.status === 'completed' ||
                  status.status === 'failed' ||
                  status.status === 'cancelled') {
                const sub = jobSubscriptions.get(jobId);
                if (sub) {
                  clearInterval(sub.intervalId);
                  jobSubscriptions.delete(jobId);
                }
              }
            } catch (error) {
              console.error(`Error polling job ${jobId}:`, error);
            }
          };

          // Start polling
          const intervalId = setInterval(poll, JOB_POLL_INTERVAL);
          poll(); // Immediate first poll

          subscription = { callbacks, intervalId };
          jobSubscriptions.set(jobId, subscription);
        }

        // Add this callback
        subscription.callbacks.add(callback);

        // Return unsubscribe function
        return () => {
          const sub = jobSubscriptions.get(jobId);
          if (sub) {
            sub.callbacks.delete(callback);
            // If no more callbacks, stop polling
            if (sub.callbacks.size === 0) {
              clearInterval(sub.intervalId);
              jobSubscriptions.delete(jobId);
            }
          }
        };
      },
    },

    // =========================================================================
    // Results Module
    // =========================================================================

    /**
     * Result retrieval and export operations.
     *
     * AGENCY NOTE: Your adapter retrieves results from your storage system.
     * Consider:
     * - Result caching strategies
     * - Large file handling (streaming, CDN)
     * - Format conversion on the fly
     */
    results: {
      /**
       * Get all results for a model.
       *
       * DEFAULT BEHAVIOR: NOT FULLY IMPLEMENTED.
       * The current backend doesn't have a dedicated results endpoint.
       *
       * AGENCY NOTE: Return results from your results storage system.
       */
      async get(modelId: string): Promise<ModelResults> {
        // Get the model to check status
        const model = await getModel(modelId);

        // Stub response - real implementation would fetch actual results
        const results: ModelResult[] = [];

        // If model is completed, it has results
        // In the real implementation, we'd fetch from a results endpoint
        if (model.status === 'completed') {
          // Placeholder - backend doesn't have results listing API yet
          results.push({
            id: `${modelId}-probability`,
            modelId,
            outputType: 'probability',
            displayName: 'Burn Probability',
            createdAt: model.updatedAt ?? model.createdAt,
            metadata: {
              crs: 'EPSG:4326',
            },
          });
        }

        return {
          model: mapModelResponse(model),
          results,
          summary: {
            durationHours: model.durationDays ? model.durationDays * 24 : 72,
          },
        };
      },

      /**
       * Get a specific result's data.
       *
       * DEFAULT BEHAVIOR: NOT IMPLEMENTED.
       *
       * AGENCY NOTE: Return GeoJSON for vector results or URL for raster results.
       */
      async getData(_resultId: string): Promise<GeoJSONGeometry | string> {
        throw new Error('getData() is not implemented in the default adapter.');
      },

      /**
       * Export model results in a specific format.
       *
       * DEFAULT BEHAVIOR: NOT IMPLEMENTED.
       *
       * AGENCY NOTE: Implement export to agency-supported formats.
       * May involve server-side format conversion.
       */
      async export(_modelId: string, _params: ExportParams): Promise<Blob> {
        throw new Error('export() is not implemented in the default adapter.');
      },

      /**
       * Get available export formats.
       *
       * DEFAULT BEHAVIOR: Returns standard GIS formats.
       *
       * AGENCY NOTE: Return formats supported by your export system.
       */
      async getExportFormats(): Promise<ExportFormat[]> {
        return [
          {
            id: 'geojson',
            name: 'GeoJSON',
            extension: 'geojson',
            category: 'vector',
            supportedOutputTypes: ['perimeter', 'probability'],
          },
          {
            id: 'geotiff',
            name: 'GeoTIFF',
            extension: 'tif',
            category: 'raster',
            supportedOutputTypes: ['probability', 'intensity', 'rate_of_spread'],
          },
          {
            id: 'shapefile',
            name: 'Shapefile',
            extension: 'shp',
            category: 'vector',
            supportedOutputTypes: ['perimeter'],
          },
        ];
      },

      // -----------------------------------------------------------------------
      // URL Generation (for embedded mode compatibility)
      // -----------------------------------------------------------------------

      /**
       * Get the URL to fetch model results.
       *
       * DEFAULT BEHAVIOR: Returns URL to Nomad backend using API_BASE_URL.
       *
       * AGENCY NOTE: Return URL appropriate for your backend/proxy configuration.
       */
      getModelResultsUrl(modelId: string): string {
        return `${baseUrl}/api/v1/models/${modelId}/results`;
      },

      /**
       * Get the preview URL for a result.
       *
       * DEFAULT BEHAVIOR: Returns URL to Nomad backend using API_BASE_URL.
       *
       * AGENCY NOTE: Return URL appropriate for your backend/proxy configuration.
       * In embedded mode, this might be a relative URL through the host's proxy.
       */
      getPreviewUrl(resultId: string, mode?: 'static' | 'dynamic'): string {
        const previewUrl = `${baseUrl}/api/v1/results/${resultId}/preview`;
        return mode ? `${previewUrl}?mode=${mode}` : previewUrl;
      },

      /**
       * Get the download URL for a result.
       *
       * DEFAULT BEHAVIOR: Returns URL to Nomad backend using API_BASE_URL.
       *
       * AGENCY NOTE: Return URL appropriate for your backend/proxy configuration.
       */
      getDownloadUrl(resultId: string): string {
        return `${baseUrl}/api/v1/results/${resultId}/download`;
      },

      /**
       * Get the tile URL template for raster results.
       *
       * DEFAULT BEHAVIOR: Returns URL template to Nomad backend.
       *
       * AGENCY NOTE: Return URL template appropriate for your tile serving setup.
       */
      getTileUrlTemplate(resultId: string): string {
        return `${baseUrl}/api/v1/results/${resultId}/tile/{z}/{x}/{y}.png`;
      },

      /**
       * Get the bounding box for a raster result.
       *
       * DEFAULT BEHAVIOR: Fetches from Nomad backend bounds endpoint.
       *
       * AGENCY NOTE: Implement bounds retrieval for your tile serving setup.
       */
      async getTileBounds(resultId: string): Promise<BBox> {
        const response = await fetch(`${baseUrl}/api/v1/results/${resultId}/bounds`);
        if (!response.ok) {
          throw new Error(`Failed to fetch tile bounds: ${response.status}`);
        }
        const data = await response.json();
        return data.bounds as BBox;
      },
    },

    // =========================================================================
    // Spatial Module
    // =========================================================================

    /**
     * Spatial data and map interaction services.
     *
     * AGENCY NOTE: This is where agency-specific integration happens.
     * The map interaction methods (draw*, addLayer, etc.) are the key
     * abstraction for embedding - your adapter implements these using
     * your host application's map component.
     *
     * Data services connect to your agency's:
     * - Weather station network
     * - Fuel type WCS/WFS services
     * - DEM services
     */
    spatial: {
      // -----------------------------------------------------------------------
      // Map Interaction Methods
      // -----------------------------------------------------------------------

      /**
       * Request user to draw a point on the map.
       *
       * DEFAULT BEHAVIOR: NOT IMPLEMENTED.
       * In SAN mode, this would use internal map hooks.
       * In ACN mode, the host app implements this.
       *
       * AGENCY NOTE: Activate your map's point drawing tool,
       * return a Promise that resolves when user completes the draw.
       */
      async drawPoint(): Promise<GeoJSON.Point> {
        throw new Error(
          'drawPoint() is not implemented in the default adapter. ' +
          'In embedded mode, the host application must implement spatial.drawPoint().'
        );
      },

      /**
       * Request user to draw a line on the map.
       *
       * DEFAULT BEHAVIOR: NOT IMPLEMENTED.
       *
       * AGENCY NOTE: Activate your map's line drawing tool.
       */
      async drawLine(): Promise<GeoJSON.LineString> {
        throw new Error(
          'drawLine() is not implemented in the default adapter. ' +
          'In embedded mode, the host application must implement spatial.drawLine().'
        );
      },

      /**
       * Request user to draw a polygon on the map.
       *
       * DEFAULT BEHAVIOR: NOT IMPLEMENTED.
       *
       * AGENCY NOTE: Activate your map's polygon drawing tool.
       */
      async drawPolygon(): Promise<GeoJSON.Polygon> {
        throw new Error(
          'drawPolygon() is not implemented in the default adapter. ' +
          'In embedded mode, the host application must implement spatial.drawPolygon().'
        );
      },

      /**
       * Subscribe to geometry changes during drawing.
       *
       * DEFAULT BEHAVIOR: Returns no-op unsubscribe.
       *
       * AGENCY NOTE: Connect to your map's drawing events.
       */
      onGeometryChange(_callback: (geometry: GeoJSONGeometry | null) => void): Unsubscribe {
        // Default implementation does nothing
        // Agency adapters would connect to their map's drawing events
        return () => {};
      },

      /**
       * Cancel any active drawing operation.
       *
       * DEFAULT BEHAVIOR: No-op.
       *
       * AGENCY NOTE: Deactivate your map's drawing tool.
       */
      cancelDraw(): void {
        // Default implementation does nothing
      },

      /**
       * Add a layer to the map.
       *
       * DEFAULT BEHAVIOR: No-op (logs warning).
       *
       * AGENCY NOTE: Add the layer to your map using your map library's API.
       */
      addLayer(_layer: MapLayer): void {
        console.warn(
          'addLayer() is not implemented in the default adapter. ' +
          'In embedded mode, the host application must implement spatial.addLayer().'
        );
      },

      /**
       * Update an existing layer.
       *
       * DEFAULT BEHAVIOR: No-op.
       *
       * AGENCY NOTE: Update the layer in your map.
       */
      updateLayer(_id: string, _updates: Partial<MapLayer>): void {
        // Default implementation does nothing
      },

      /**
       * Remove a layer from the map.
       *
       * DEFAULT BEHAVIOR: No-op.
       *
       * AGENCY NOTE: Remove the layer from your map.
       */
      removeLayer(_id: string): void {
        // Default implementation does nothing
      },

      /**
       * Fit the map view to a bounding box.
       *
       * DEFAULT BEHAVIOR: No-op.
       *
       * AGENCY NOTE: Call your map's fitBounds/flyTo method.
       */
      fitBounds(_bounds: BBox, _options?: { padding?: number; animate?: boolean }): void {
        // Default implementation does nothing
      },

      /**
       * Get the current map bounds.
       *
       * DEFAULT BEHAVIOR: Returns world bounds.
       *
       * AGENCY NOTE: Return your map's current visible bounds.
       */
      getBounds(): BBox {
        // Default implementation returns world bounds
        return [-180, -90, 180, 90];
      },

      // -----------------------------------------------------------------------
      // Data Services
      // -----------------------------------------------------------------------

      /**
       * Get weather stations within bounds.
       *
       * DEFAULT BEHAVIOR: Returns empty array (not implemented).
       *
       * AGENCY NOTE: Query your weather station database or WFS service.
       */
      async getWeatherStations(_bounds: BBox): Promise<WeatherStation[]> {
        // Default implementation doesn't have weather station integration
        // Agency adapters would connect to their weather networks
        return [];
      },

      /**
       * Get fuel type data for a region.
       *
       * DEFAULT BEHAVIOR: Returns stub data.
       *
       * AGENCY NOTE: Connect to your fuel type WCS/WFS service.
       */
      async getFuelTypes(bounds: BBox): Promise<FuelTypeData> {
        // Default implementation returns stub
        // Agency adapters would connect to their fuel type services
        return {
          bounds,
          fuelTypes: [
            { code: 'C-2', name: 'Boreal Spruce', color: '#228B22' },
            { code: 'M-1/M-2', name: 'Boreal Mixedwood', color: '#90EE90' },
            { code: 'D-1/D-2', name: 'Aspen', color: '#ADFF2F' },
          ],
          serviceUrl: undefined,
          layerName: undefined,
        };
      },

      /**
       * Get elevation data for a region.
       *
       * DEFAULT BEHAVIOR: Returns stub data.
       *
       * AGENCY NOTE: Connect to your DEM service.
       */
      async getElevation(bounds: BBox): Promise<ElevationData> {
        return {
          bounds,
          serviceUrl: '',
          resolutionM: 30,
        };
      },
    },

    // =========================================================================
    // Config Module
    // =========================================================================

    /**
     * System configuration.
     *
     * AGENCY NOTE: Return agency-specific configuration.
     * This controls branding, available features, and export options.
     */
    config: {
      /**
       * Get available fire modeling engines.
       *
       * DEFAULT BEHAVIOR: Returns FireSTARR and WISE (WISE disabled).
       *
       * AGENCY NOTE: Return engines available to your agency.
       * Some agencies may only have access to certain engines.
       */
      async getAvailableEngines(): Promise<Engine[]> {
        return [
          {
            id: 'firestarr',
            name: 'FireSTARR',
            description: 'Probabilistic fire spread model',
            available: true,
            capabilities: {
              probabilistic: true,
              deterministic: false,
              polygonIgnition: true,
              lineIgnition: false,
              maxDurationHours: 720, // 30 days
            },
          },
          {
            id: 'wise',
            name: 'WISE',
            description: 'Wildfire Intelligence and Scenario Engine',
            available: false, // Not yet implemented
            capabilities: {
              probabilistic: false,
              deterministic: true,
              polygonIgnition: true,
              lineIgnition: true,
              maxDurationHours: 168, // 7 days
            },
          },
        ];
      },

      /**
       * Get agency-specific configuration.
       *
       * DEFAULT BEHAVIOR: Fetches from /api/v1/config and maps to AgencyConfig.
       * Falls back to generic Nomad configuration if fetch fails.
       *
       * AGENCY NOTE: Return your agency's branding and settings.
       */
      async getAgencyConfig(): Promise<AgencyConfig> {
        // Default branding values
        const defaultBranding = {
          primaryColor: '#1976d2',
          secondaryColor: '#0d47a1',
        };

        // Default configuration used as fallback
        const defaultConfig: AgencyConfig = {
          id: 'nomad',
          name: 'Project Nomad',
          logoUrl: undefined,
          branding: defaultBranding,
          defaultMapCenter: {
            lat: 62.45,
            lng: -114.37,
            zoom: 5,
          },
          exportFormats: [
            {
              id: 'geojson',
              name: 'GeoJSON',
              extension: 'geojson',
              category: 'vector' as const,
              supportedOutputTypes: ['perimeter', 'probability'] as const,
            },
          ],
          contact: {
            name: 'Nomad Support',
            email: 'support@nomad.example.com',
          },
        };

        try {
          const config = await getConfig();

          // Map backend export format strings to ExportFormat objects
          const exportFormats: ExportFormat[] = (config.features.exportFormats || []).map(
            (format) => ({
              id: format,
              name: format.charAt(0).toUpperCase() + format.slice(1),
              extension: format === 'shapefile' ? 'shp' : format,
              category: (format === 'geotiff' ? 'raster' : 'vector') as 'vector' | 'raster',
              supportedOutputTypes: ['perimeter', 'probability'] as const,
            })
          );

          return {
            id: 'nomad',
            name: config.branding.name || defaultConfig.name,
            logoUrl: config.branding.logoUrl || undefined,
            branding: {
              primaryColor: config.branding.primaryColor || defaultBranding.primaryColor,
              secondaryColor: defaultBranding.secondaryColor, // Backend doesn't provide this
            },
            defaultMapCenter: defaultConfig.defaultMapCenter, // Backend doesn't provide this
            exportFormats: exportFormats.length > 0 ? exportFormats : defaultConfig.exportFormats,
            contact: defaultConfig.contact, // Backend doesn't provide this
          };
        } catch (error) {
          console.warn('[DefaultOpenNomadAPI] Failed to fetch config, using defaults:', error);
          return defaultConfig;
        }
      },
    },
  };
}
