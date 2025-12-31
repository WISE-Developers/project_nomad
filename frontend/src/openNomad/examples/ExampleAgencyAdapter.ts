/**
 * Example Agency Adapter
 *
 * Copy this file as a starting point for your agency's openNomad adapter.
 * Replace the TODO comments with your agency's implementation.
 *
 * @module openNomad/examples
 */

import type {
  IOpenNomadAPI,
  User,
  Model,
  ModelStatus,
  ModelCreateParams,
  ModelFilter,
  PaginationParams,
  PaginatedResponse,
  Job,
  JobStatusDetail,
  ModelResults,
  ExportFormat,
  ExportParams,
  MapLayer,
  WeatherStation,
  FuelTypeData,
  ElevationData,
  Engine,
  AgencyConfig,
  BBox,
  GeoJSONGeometry,
  Unsubscribe,
} from '../api.js';

// =============================================================================
// Configuration
// =============================================================================

/**
 * Options for creating the agency adapter.
 * Add your agency-specific configuration here.
 */
export interface AgencyAdapterOptions {
  /** Auth token from host application */
  authToken: string;
  /** Base URL for your agency's Nomad API */
  apiBaseUrl?: string;
  /** Your agency identifier */
  agencyId?: string;
}

// =============================================================================
// Adapter Factory
// =============================================================================

/**
 * Creates an openNomad adapter for your agency.
 *
 * @example
 * ```tsx
 * const adapter = createAgencyAdapter({
 *   authToken: hostApp.getAuthToken(),
 *   apiBaseUrl: 'https://api.your-agency.gov/nomad',
 * });
 *
 * <OpenNomadProvider adapter={adapter}>
 *   <DashboardContainer mode="embedded" />
 * </OpenNomadProvider>
 * ```
 */
export function createAgencyAdapter(options: AgencyAdapterOptions): IOpenNomadAPI {
  const {
    authToken,
    apiBaseUrl = '/api/nomad',
    agencyId = 'your-agency',
  } = options;

  // Common headers for API calls
  const headers = {
    'Authorization': `Bearer ${authToken}`,
    'Content-Type': 'application/json',
  };

  // Helper for API calls
  async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
      headers: { ...headers, ...options?.headers },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // ===========================================================================
  // Auth Module
  // ===========================================================================

  const auth: IOpenNomadAPI['auth'] = {
    async getCurrentUser(): Promise<User | null> {
      // TODO: Implement - decode JWT or fetch from your auth API
      // Example:
      // const userData = await apiFetch<YourUserType>('/auth/me');
      // return mapToNomadUser(userData);

      // Placeholder implementation
      return {
        id: 'user-id',
        name: 'Agency User',
        email: 'user@agency.gov',
        role: 'fban',
        agencyId,
      };
    },

    async getAuthToken(): Promise<string | null> {
      return authToken;
    },

    onAuthChange(_callback: (user: User | null) => void): Unsubscribe {
      // TODO: Subscribe to your auth state changes
      // Example:
      // return yourAuthService.onStateChange((state) => {
      //   _callback(state.user ? mapToNomadUser(state.user) : null);
      // });

      // Placeholder - no-op
      return () => {};
    },
  };

  // ===========================================================================
  // Models Module
  // ===========================================================================

  const models: IOpenNomadAPI['models'] = {
    async create(params: ModelCreateParams): Promise<Model> {
      // TODO: POST to your models API
      return apiFetch<Model>('/models', {
        method: 'POST',
        body: JSON.stringify(params),
      });
    },

    async list(
      filter?: ModelFilter,
      pagination?: PaginationParams
    ): Promise<PaginatedResponse<Model>> {
      // TODO: GET from your models API with filters
      const params = new URLSearchParams();
      if (filter?.status) params.set('status', String(filter.status));
      if (filter?.engine) params.set('engine', filter.engine);
      if (filter?.search) params.set('search', filter.search);
      if (pagination?.page) params.set('page', String(pagination.page));
      if (pagination?.limit) params.set('limit', String(pagination.limit));

      return apiFetch<PaginatedResponse<Model>>(`/models?${params}`);
    },

    async get(id: string): Promise<Model> {
      return apiFetch<Model>(`/models/${id}`);
    },

    async update(id: string, updates: Partial<ModelCreateParams>): Promise<Model> {
      return apiFetch<Model>(`/models/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
    },

    async delete(id: string): Promise<void> {
      await apiFetch(`/models/${id}`, { method: 'DELETE' });
    },

    async getStatus(id: string): Promise<ModelStatus> {
      const model = await this.get(id);
      return model.status;
    },
  };

  // ===========================================================================
  // Jobs Module
  // ===========================================================================

  // Track active job subscriptions for cleanup
  const jobSubscriptions = new Map<string, {
    callbacks: Set<(status: JobStatusDetail) => void>;
    intervalId: ReturnType<typeof setInterval>;
  }>();

  const jobs: IOpenNomadAPI['jobs'] = {
    async submit(modelId: string): Promise<Job> {
      return apiFetch<Job>(`/models/${modelId}/execute`, {
        method: 'POST',
      });
    },

    async cancel(jobId: string): Promise<void> {
      await apiFetch(`/jobs/${jobId}/cancel`, { method: 'POST' });
    },

    async getStatus(jobId: string): Promise<JobStatusDetail> {
      return apiFetch<JobStatusDetail>(`/jobs/${jobId}`);
    },

    onStatusChange(
      jobId: string,
      callback: (status: JobStatusDetail) => void
    ): Unsubscribe {
      // TODO: If you have WebSocket support, use it instead of polling
      // Example WebSocket:
      // const ws = new WebSocket(`wss://${apiBaseUrl}/jobs/${jobId}/stream`);
      // ws.onmessage = (e) => callback(JSON.parse(e.data));
      // return () => ws.close();

      // Polling implementation
      let subscription = jobSubscriptions.get(jobId);

      if (!subscription) {
        const callbacks = new Set<(status: JobStatusDetail) => void>();

        const poll = async () => {
          try {
            const status = await this.getStatus(jobId);
            callbacks.forEach((cb) => cb(status));

            // Stop polling if terminal state
            if (['completed', 'failed', 'cancelled'].includes(status.status)) {
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

        const intervalId = setInterval(poll, 3000);
        poll(); // Immediate first poll

        subscription = { callbacks, intervalId };
        jobSubscriptions.set(jobId, subscription);
      }

      subscription.callbacks.add(callback);

      return () => {
        const sub = jobSubscriptions.get(jobId);
        if (sub) {
          sub.callbacks.delete(callback);
          if (sub.callbacks.size === 0) {
            clearInterval(sub.intervalId);
            jobSubscriptions.delete(jobId);
          }
        }
      };
    },
  };

  // ===========================================================================
  // Results Module
  // ===========================================================================

  const results: IOpenNomadAPI['results'] = {
    async get(modelId: string): Promise<ModelResults> {
      return apiFetch<ModelResults>(`/models/${modelId}/results`);
    },

    async getData(resultId: string): Promise<GeoJSONGeometry | string> {
      // TODO: Implement - return GeoJSON or raster URL
      const response = await fetch(`${apiBaseUrl}/results/${resultId}/data`, {
        headers,
      });

      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        return response.json();
      }
      return response.url;
    },

    async export(modelId: string, params: ExportParams): Promise<Blob> {
      const response = await fetch(`${apiBaseUrl}/models/${modelId}/export`, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      });
      return response.blob();
    },

    async getExportFormats(): Promise<ExportFormat[]> {
      // TODO: Return formats your agency supports
      return [
        {
          id: 'geojson',
          name: 'GeoJSON',
          extension: 'geojson',
          category: 'vector',
          supportedOutputTypes: ['perimeter', 'probability'],
        },
        {
          id: 'shapefile',
          name: 'Shapefile',
          extension: 'shp',
          category: 'vector',
          supportedOutputTypes: ['perimeter'],
        },
        {
          id: 'geotiff',
          name: 'GeoTIFF',
          extension: 'tif',
          category: 'raster',
          supportedOutputTypes: ['probability', 'intensity', 'rate_of_spread'],
        },
      ];
    },
  };

  // ===========================================================================
  // Spatial Module
  // ===========================================================================

  const spatial: IOpenNomadAPI['spatial'] = {
    // -------------------------------------------------------------------------
    // Map Interaction (Host-Provided)
    // -------------------------------------------------------------------------

    // TODO: Implement these using your host application's map component.
    // These are the key methods that enable embedding - your adapter
    // bridges between Nomad's requests and your map's drawing tools.

    async drawPoint(): Promise<GeoJSON.Point> {
      // TODO: Activate your map's point drawing tool
      // Return the geometry when user completes drawing
      throw new Error(
        'drawPoint() must be implemented by your agency adapter. ' +
        'Use your host application\'s map drawing tools.'
      );
    },

    async drawLine(): Promise<GeoJSON.LineString> {
      // TODO: Activate your map's line drawing tool
      throw new Error(
        'drawLine() must be implemented by your agency adapter. ' +
        'Use your host application\'s map drawing tools.'
      );
    },

    async drawPolygon(): Promise<GeoJSON.Polygon> {
      // TODO: Activate your map's polygon drawing tool
      throw new Error(
        'drawPolygon() must be implemented by your agency adapter. ' +
        'Use your host application\'s map drawing tools.'
      );
    },

    onGeometryChange(_callback: (geometry: GeoJSONGeometry | null) => void): Unsubscribe {
      // TODO: Subscribe to your map's drawing events
      // Call callback with geometry as user draws
      return () => {};
    },

    cancelDraw(): void {
      // TODO: Deactivate your map's drawing tool
    },

    addLayer(_layer: MapLayer): void {
      // TODO: Add layer to your map using your map library's API
      // Example for Mapbox GL:
      // map.addSource(layer.id, { type: 'geojson', data: layer.data });
      // map.addLayer({ id: layer.id, source: layer.id, ... });
    },

    updateLayer(_id: string, _updates: Partial<MapLayer>): void {
      // TODO: Update an existing layer
    },

    removeLayer(_id: string): void {
      // TODO: Remove layer from your map
    },

    fitBounds(_bounds: BBox, _options?: { padding?: number; animate?: boolean }): void {
      // TODO: Fit your map to these bounds
      // Example: map.fitBounds(bounds, { padding, animate });
    },

    getBounds(): BBox {
      // TODO: Return your map's current visible bounds
      return [-180, -90, 180, 90];
    },

    // -------------------------------------------------------------------------
    // Data Services
    // -------------------------------------------------------------------------

    async getWeatherStations(bounds: BBox): Promise<WeatherStation[]> {
      // TODO: Query your agency's weather station service
      const [minLng, minLat, maxLng, maxLat] = bounds;
      return apiFetch<WeatherStation[]>(
        `/spatial/weather-stations?bbox=${minLng},${minLat},${maxLng},${maxLat}`
      );
    },

    async getFuelTypes(bounds: BBox): Promise<FuelTypeData> {
      // TODO: Return your agency's fuel type service info
      return {
        bounds,
        fuelTypes: [
          { code: 'C-2', name: 'Boreal Spruce', color: '#228B22' },
          { code: 'C-3', name: 'Mature Jack Pine', color: '#006400' },
          { code: 'M-1', name: 'Boreal Mixedwood', color: '#90EE90' },
          { code: 'M-2', name: 'Boreal Mixedwood', color: '#98FB98' },
          { code: 'D-1', name: 'Leafless Aspen', color: '#FFD700' },
          { code: 'S-1', name: 'Jack Pine Slash', color: '#8B4513' },
          { code: 'O-1a', name: 'Standing Grass', color: '#F0E68C' },
          // Add your agency's fuel types...
        ],
        serviceUrl: 'https://your-geoserver/wcs/fueltypes',
        layerName: 'fuels',
      };
    },

    async getElevation(bounds: BBox): Promise<ElevationData> {
      // TODO: Return your agency's DEM service info
      return {
        bounds,
        serviceUrl: 'https://your-geoserver/wcs/dem',
        resolutionM: 30,
      };
    },
  };

  // ===========================================================================
  // Config Module
  // ===========================================================================

  const config: IOpenNomadAPI['config'] = {
    async getAvailableEngines(): Promise<Engine[]> {
      // TODO: Return engines your agency supports
      return [
        {
          id: 'firestarr',
          name: 'FireSTARR',
          description: 'Stochastic fire spread modeling',
          available: true,
          capabilities: {
            probabilistic: true,
            deterministic: true,
            polygonIgnition: true,
            lineIgnition: true,
            maxDurationHours: 720,
          },
        },
        // Add WISE if your agency supports it
        // {
        //   id: 'wise',
        //   name: 'WISE',
        //   description: 'Wildfire Intelligence & Scenario Engine',
        //   available: true,
        //   capabilities: {...},
        // },
      ];
    },

    async getAgencyConfig(): Promise<AgencyConfig> {
      // TODO: Return your agency's configuration
      return {
        id: agencyId,
        name: 'Your Agency Name',
        logoUrl: '/assets/agency-logo.png',
        branding: {
          primaryColor: '#1a5f2a', // Your agency color
          secondaryColor: '#ffffff',
        },
        exportFormats: [
          { id: 'geojson', name: 'GeoJSON', extension: 'geojson', category: 'vector', supportedOutputTypes: ['perimeter'] },
          { id: 'shapefile', name: 'Shapefile', extension: 'shp', category: 'vector', supportedOutputTypes: ['perimeter'] },
        ],
      };
    },
  };

  // ===========================================================================
  // Return Complete Adapter
  // ===========================================================================

  return {
    auth,
    models,
    jobs,
    results,
    spatial,
    config,
  };
}
