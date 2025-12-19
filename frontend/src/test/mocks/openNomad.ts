/**
 * Mock openNomad API for testing
 *
 * This mock implementation can be used to test components that
 * depend on the openNomad API without making real API calls.
 *
 * @module test/mocks
 */

import type {
  IOpenNomadAPI,
  User,
  Model,
  ModelCreateParams,
  ModelFilter,
  PaginationParams,
  PaginatedResponse,
  Job,
  JobStatusDetail,
  ModelResults,
  ExportFormat,
  ExportParams,
  WeatherStation,
  FuelTypeData,
  ElevationData,
  Engine,
  AgencyConfig,
  BBox,
  GeoJSONGeometry,
  Unsubscribe,
} from '../../openNomad/api.js';
import { vi } from 'vitest';

// =============================================================================
// Test Data
// =============================================================================

export const mockUser: User = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  role: 'fban',
  agencyId: 'test-agency',
};

export const mockModels: Model[] = [
  {
    id: 'model-1',
    name: 'Test Fire Model 1',
    description: 'A test model',
    engine: 'firestarr',
    status: 'completed',
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-15T11:00:00Z',
    createdBy: 'user-1',
    ignitionGeometry: {
      type: 'Point',
      coordinates: [-114.0, 62.0],
    },
    temporal: {
      startTime: '2024-01-15T10:00:00Z',
      duration: 72,
      durationUnit: 'hours',
    },
  },
  {
    id: 'model-2',
    name: 'Test Fire Model 2',
    description: 'Another test model',
    engine: 'wise',
    status: 'running',
    createdAt: '2024-01-16T10:00:00Z',
    updatedAt: '2024-01-16T10:30:00Z',
    createdBy: 'user-1',
    ignitionGeometry: {
      type: 'Point',
      coordinates: [-115.0, 63.0],
    },
    temporal: {
      startTime: '2024-01-16T10:00:00Z',
      duration: 48,
      durationUnit: 'hours',
    },
  },
];

export const mockJob: Job = {
  id: 'job-1',
  modelId: 'model-2',
  status: 'running',
  createdAt: '2024-01-16T10:00:00Z',
  progress: 45,
  currentPhase: 'simulation',
};

export const mockJobStatus: JobStatusDetail = {
  jobId: 'job-1',
  modelId: 'model-2',
  status: 'running',
  progress: 45,
  currentPhase: 'simulation',
  phases: [
    { name: 'initialization', status: 'completed' },
    { name: 'simulation', status: 'running', progress: 45 },
    { name: 'postprocessing', status: 'pending' },
  ],
  startedAt: '2024-01-16T10:00:00Z',
  estimatedCompletion: '2024-01-16T12:00:00Z',
};

export const mockResults: ModelResults = {
  modelId: 'model-1',
  outputs: [
    {
      id: 'result-1',
      type: 'perimeter',
      name: 'Fire Perimeter 24h',
      format: 'geojson',
      timestamp: '2024-01-16T10:00:00Z',
    },
    {
      id: 'result-2',
      type: 'probability',
      name: 'Burn Probability',
      format: 'geotiff',
      timestamp: '2024-01-16T10:00:00Z',
    },
  ],
  generatedAt: '2024-01-16T11:00:00Z',
};

export const mockExportFormats: ExportFormat[] = [
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
];

export const mockEngines: Engine[] = [
  {
    id: 'firestarr',
    name: 'FireSTARR',
    description: 'Stochastic fire spread modeling',
    available: true,
    capabilities: {
      probabilistic: true,
      deterministic: true,
      polygonIgnition: true,
      lineIgnition: false,
      maxDurationHours: 720,
    },
  },
  {
    id: 'wise',
    name: 'WISE',
    description: 'Wildfire Intelligence & Scenario Engine',
    available: true,
    capabilities: {
      probabilistic: false,
      deterministic: true,
      polygonIgnition: true,
      lineIgnition: true,
      maxDurationHours: 168,
    },
  },
];

export const mockAgencyConfig: AgencyConfig = {
  id: 'test-agency',
  name: 'Test Agency',
  logoUrl: '/assets/test-logo.png',
  branding: {
    primaryColor: '#1a5f2a',
    secondaryColor: '#ffffff',
  },
  exportFormats: mockExportFormats,
};

// =============================================================================
// Mock API Factory
// =============================================================================

export function createMockOpenNomadAPI(): IOpenNomadAPI {
  const statusCallbacks = new Map<string, Set<(status: JobStatusDetail) => void>>();
  const authCallbacks = new Set<(user: User | null) => void>();

  return {
    auth: {
      getCurrentUser: vi.fn().mockResolvedValue(mockUser),
      getAuthToken: vi.fn().mockResolvedValue('mock-token'),
      onAuthChange: vi.fn((callback: (user: User | null) => void): Unsubscribe => {
        authCallbacks.add(callback);
        return () => authCallbacks.delete(callback);
      }),
    },

    models: {
      create: vi.fn((params: ModelCreateParams): Promise<Model> => {
        const newModel: Model = {
          id: `model-${Date.now()}`,
          name: params.name,
          description: params.description,
          engine: params.engine,
          status: 'draft',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdBy: 'user-1',
          ignitionGeometry: params.ignitionGeometry,
          temporal: params.temporal,
          weather: params.weather,
          outputs: params.outputs,
        };
        return Promise.resolve(newModel);
      }),

      list: vi.fn(
        (_filter?: ModelFilter, _pagination?: PaginationParams): Promise<PaginatedResponse<Model>> => {
          return Promise.resolve({
            data: mockModels,
            total: mockModels.length,
            page: 1,
            limit: 20,
            totalPages: 1,
          });
        }
      ),

      get: vi.fn((id: string): Promise<Model> => {
        const model = mockModels.find((m) => m.id === id);
        if (!model) {
          return Promise.reject(new Error(`Model ${id} not found`));
        }
        return Promise.resolve(model);
      }),

      update: vi.fn((id: string, updates: Partial<ModelCreateParams>): Promise<Model> => {
        const model = mockModels.find((m) => m.id === id);
        if (!model) {
          return Promise.reject(new Error(`Model ${id} not found`));
        }
        return Promise.resolve({ ...model, ...updates, updatedAt: new Date().toISOString() });
      }),

      delete: vi.fn((_id: string): Promise<void> => {
        return Promise.resolve();
      }),

      getStatus: vi.fn((id: string) => {
        const model = mockModels.find((m) => m.id === id);
        return Promise.resolve(model?.status || 'unknown');
      }),
    },

    jobs: {
      submit: vi.fn((_modelId: string): Promise<Job> => {
        return Promise.resolve(mockJob);
      }),

      cancel: vi.fn((_jobId: string): Promise<void> => {
        return Promise.resolve();
      }),

      getStatus: vi.fn((_jobId: string): Promise<JobStatusDetail> => {
        return Promise.resolve(mockJobStatus);
      }),

      onStatusChange: vi.fn(
        (jobId: string, callback: (status: JobStatusDetail) => void): Unsubscribe => {
          if (!statusCallbacks.has(jobId)) {
            statusCallbacks.set(jobId, new Set());
          }
          statusCallbacks.get(jobId)!.add(callback);

          // Trigger initial callback
          setTimeout(() => callback(mockJobStatus), 0);

          return () => {
            statusCallbacks.get(jobId)?.delete(callback);
          };
        }
      ),
    },

    results: {
      get: vi.fn((_modelId: string): Promise<ModelResults> => {
        return Promise.resolve(mockResults);
      }),

      getData: vi.fn((_resultId: string): Promise<GeoJSONGeometry | string> => {
        return Promise.resolve({
          type: 'Polygon' as const,
          coordinates: [
            [
              [-114.0, 62.0],
              [-114.1, 62.0],
              [-114.1, 62.1],
              [-114.0, 62.1],
              [-114.0, 62.0],
            ],
          ],
        });
      }),

      export: vi.fn((_modelId: string, _params: ExportParams): Promise<Blob> => {
        return Promise.resolve(new Blob(['mock export data'], { type: 'application/json' }));
      }),

      getExportFormats: vi.fn((): Promise<ExportFormat[]> => {
        return Promise.resolve(mockExportFormats);
      }),
    },

    spatial: {
      getWeatherStations: vi.fn((_bounds: BBox): Promise<WeatherStation[]> => {
        return Promise.resolve([
          {
            id: 'station-1',
            name: 'Test Weather Station',
            location: { type: 'Point', coordinates: [-114.5, 62.5] },
            provider: 'Environment Canada',
            lastUpdate: new Date().toISOString(),
          },
        ]);
      }),

      getFuelTypes: vi.fn((bounds: BBox): Promise<FuelTypeData> => {
        return Promise.resolve({
          bounds,
          fuelTypes: [
            { code: 'C-2', name: 'Boreal Spruce', color: '#228B22' },
            { code: 'M-1', name: 'Boreal Mixedwood', color: '#90EE90' },
          ],
          serviceUrl: 'https://test-geoserver/wcs/fueltypes',
          layerName: 'fuels',
        });
      }),

      getElevation: vi.fn((bounds: BBox): Promise<ElevationData> => {
        return Promise.resolve({
          bounds,
          serviceUrl: 'https://test-geoserver/wcs/dem',
          resolutionM: 30,
        });
      }),
    },

    config: {
      getAvailableEngines: vi.fn((): Promise<Engine[]> => {
        return Promise.resolve(mockEngines);
      }),

      getAgencyConfig: vi.fn((): Promise<AgencyConfig> => {
        return Promise.resolve(mockAgencyConfig);
      }),
    },
  };
}
