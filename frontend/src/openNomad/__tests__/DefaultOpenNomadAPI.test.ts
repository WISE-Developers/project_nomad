/**
 * Tests for DefaultOpenNomadAPI
 *
 * These tests verify the default openNomad adapter works correctly.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDefaultAdapter } from '../default';
import type { IOpenNomadAPI } from '../api';

// Mock the services/api module
vi.mock('../../services/api', () => ({
  getModels: vi.fn(),
  getModel: vi.fn(),
  deleteModel: vi.fn(),
  getJob: vi.fn(),
  getConfig: vi.fn(),
}));

import { getModels, getModel, deleteModel, getJob, getConfig } from '../../services/api';

describe('DefaultOpenNomadAPI', () => {
  let api: IOpenNomadAPI;

  beforeEach(() => {
    api = createDefaultAdapter();
    vi.clearAllMocks();
    // Clear localStorage
    localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createDefaultAdapter', () => {
    it('should create an adapter with all required modules', () => {
      expect(api).toBeDefined();
      expect(api.auth).toBeDefined();
      expect(api.models).toBeDefined();
      expect(api.jobs).toBeDefined();
      expect(api.results).toBeDefined();
      expect(api.spatial).toBeDefined();
      expect(api.config).toBeDefined();
    });
  });

  describe('auth module', () => {
    describe('getCurrentUser', () => {
      it('should return null when no user is logged in', async () => {
        const user = await api.auth.getCurrentUser();
        expect(user).toBeNull();
      });

      it('should return user when username is in localStorage', async () => {
        localStorage.setItem('nomad_username', 'testuser');
        const user = await api.auth.getCurrentUser();
        expect(user).not.toBeNull();
        expect(user?.id).toBe('testuser');
        expect(user?.name).toBe('testuser');
        expect(user?.role).toBe('fban');
      });
    });

    describe('getAuthToken', () => {
      it('should return null for simple auth mode', async () => {
        const token = await api.auth.getAuthToken();
        expect(token).toBeNull();
      });
    });

    describe('onAuthChange', () => {
      it('should return an unsubscribe function', () => {
        const callback = vi.fn();
        const unsubscribe = api.auth.onAuthChange(callback);
        expect(typeof unsubscribe).toBe('function');
        unsubscribe();
      });
    });
  });

  describe('models module', () => {
    describe('list', () => {
      it('should fetch and transform models from backend', async () => {
        const mockModels = [
          {
            id: 'model-1',
            name: 'Test Model 1',
            engineType: 'firestarr',
            status: 'completed',
            createdAt: '2024-01-01T00:00:00Z',
            userId: 'user1',
          },
          {
            id: 'model-2',
            name: 'Test Model 2',
            engineType: 'firestarr',
            status: 'running',
            createdAt: '2024-01-02T00:00:00Z',
            userId: 'user1',
          },
        ];

        vi.mocked(getModels).mockResolvedValue({
          models: mockModels,
          total: 2,
        });

        const result = await api.models.list();

        expect(getModels).toHaveBeenCalledTimes(1);
        expect(result.data).toHaveLength(2);
        expect(result.data[0].id).toBe('model-1');
        expect(result.data[0].engine).toBe('firestarr');
        expect(result.total).toBe(2);
      });

      it('should apply status filter', async () => {
        const mockModels = [
          {
            id: 'model-1',
            name: 'Completed Model',
            engineType: 'firestarr',
            status: 'completed',
            createdAt: '2024-01-01T00:00:00Z',
            userId: 'user1',
          },
          {
            id: 'model-2',
            name: 'Running Model',
            engineType: 'firestarr',
            status: 'running',
            createdAt: '2024-01-02T00:00:00Z',
            userId: 'user1',
          },
        ];

        vi.mocked(getModels).mockResolvedValue({
          models: mockModels,
          total: 2,
        });

        const result = await api.models.list({ status: 'completed' });

        expect(result.data).toHaveLength(1);
        expect(result.data[0].status).toBe('completed');
      });

      it('should apply search filter', async () => {
        const mockModels = [
          {
            id: 'model-1',
            name: 'Fort McMurray Fire',
            engineType: 'firestarr',
            status: 'completed',
            createdAt: '2024-01-01T00:00:00Z',
            userId: 'user1',
          },
          {
            id: 'model-2',
            name: 'Yellowknife Test',
            engineType: 'firestarr',
            status: 'completed',
            createdAt: '2024-01-02T00:00:00Z',
            userId: 'user1',
          },
        ];

        vi.mocked(getModels).mockResolvedValue({
          models: mockModels,
          total: 2,
        });

        const result = await api.models.list({ search: 'McMurray' });

        expect(result.data).toHaveLength(1);
        expect(result.data[0].name).toBe('Fort McMurray Fire');
      });

      it('should apply pagination', async () => {
        const mockModels = Array.from({ length: 25 }, (_, i) => ({
          id: `model-${i}`,
          name: `Model ${i}`,
          engineType: 'firestarr',
          status: 'completed',
          createdAt: '2024-01-01T00:00:00Z',
          userId: 'user1',
        }));

        vi.mocked(getModels).mockResolvedValue({
          models: mockModels,
          total: 25,
        });

        const result = await api.models.list({}, { page: 2, limit: 10 });

        expect(result.data).toHaveLength(10);
        expect(result.page).toBe(2);
        expect(result.totalPages).toBe(3);
      });
    });

    describe('get', () => {
      it('should fetch and transform a single model', async () => {
        const mockModel = {
          id: 'model-1',
          name: 'Test Model',
          engineType: 'firestarr',
          status: 'completed',
          createdAt: '2024-01-01T00:00:00Z',
          userId: 'user1',
        };

        vi.mocked(getModel).mockResolvedValue(mockModel);

        const result = await api.models.get('model-1');

        expect(getModel).toHaveBeenCalledWith('model-1');
        expect(result.id).toBe('model-1');
        expect(result.engine).toBe('firestarr');
      });
    });

    describe('delete', () => {
      it('should call delete endpoint', async () => {
        vi.mocked(deleteModel).mockResolvedValue({
          message: 'Deleted',
          deletedResults: 1,
        });

        await api.models.delete('model-1');

        expect(deleteModel).toHaveBeenCalledWith('model-1');
      });
    });

    describe('create', () => {
      it('should throw not implemented error', async () => {
        await expect(
          api.models.create({
            name: 'Test',
            engine: 'firestarr',
            geometry: { type: 'Point', coordinates: [0, 0] },
            temporal: {
              startDate: '2024-01-01',
              startTime: '12:00',
              durationHours: 24,
              timezone: 'America/Edmonton',
            },
            weather: { source: 'csv' },
          })
        ).rejects.toThrow('create() is not implemented');
      });
    });
  });

  describe('jobs module', () => {
    describe('getStatus', () => {
      it('should fetch and transform job status', async () => {
        const mockJob = {
          id: 'job-1',
          modelId: 'model-1',
          status: 'running' as const,
          progress: 50,
          createdAt: '2024-01-01T00:00:00Z',
          startedAt: '2024-01-01T00:01:00Z',
        };

        vi.mocked(getJob).mockResolvedValue(mockJob);

        const result = await api.jobs.getStatus('job-1');

        expect(getJob).toHaveBeenCalledWith('job-1');
        expect(result.id).toBe('job-1');
        expect(result.status).toBe('running');
        expect(result.progress).toBe(50);
      });
    });

    describe('onStatusChange', () => {
      it('should return unsubscribe function', () => {
        vi.mocked(getJob).mockResolvedValue({
          id: 'job-1',
          modelId: 'model-1',
          status: 'completed',
          progress: 100,
          createdAt: '2024-01-01T00:00:00Z',
        });

        const callback = vi.fn();
        const unsubscribe = api.jobs.onStatusChange('job-1', callback);

        expect(typeof unsubscribe).toBe('function');
        unsubscribe();
      });
    });
  });

  describe('config module', () => {
    describe('getAvailableEngines', () => {
      it('should return available engines', async () => {
        const engines = await api.config.getAvailableEngines();

        expect(engines).toHaveLength(2);
        expect(engines.find(e => e.id === 'firestarr')).toBeDefined();
        expect(engines.find(e => e.id === 'firestarr')?.available).toBe(true);
        expect(engines.find(e => e.id === 'wise')?.available).toBe(false);
      });
    });

    describe('getAgencyConfig', () => {
      it('should fetch config from backend and map response', async () => {
        const mockConfigResponse = {
          deploymentMode: 'SAN' as const,
          branding: {
            name: 'NWT Fire Center',
            logoUrl: 'https://example.com/logo.png',
            primaryColor: '#ff5722',
          },
          features: {
            engines: ['firestarr'],
            exportFormats: ['geojson', 'geotiff', 'shapefile'],
          },
        };

        vi.mocked(getConfig).mockResolvedValue(mockConfigResponse);

        const config = await api.config.getAgencyConfig();

        expect(getConfig).toHaveBeenCalledTimes(1);
        expect(config.name).toBe('NWT Fire Center');
        expect(config.logoUrl).toBe('https://example.com/logo.png');
        expect(config.branding?.primaryColor).toBe('#ff5722');
        expect(config.exportFormats).toHaveLength(3);
        expect(config.exportFormats?.find(f => f.id === 'geotiff')?.category).toBe('raster');
      });

      it('should return default config when fetch fails', async () => {
        vi.mocked(getConfig).mockRejectedValue(new Error('Network error'));

        const config = await api.config.getAgencyConfig();

        expect(getConfig).toHaveBeenCalledTimes(1);
        expect(config.id).toBe('nomad');
        expect(config.name).toBe('Project Nomad');
        expect(config.branding?.primaryColor).toBe('#1976d2');
        expect(config.exportFormats).toHaveLength(1);
        expect(config.exportFormats?.[0].id).toBe('geojson');
      });

      it('should use default branding when backend returns null values', async () => {
        const mockConfigResponse = {
          deploymentMode: 'SAN' as const,
          branding: {
            name: '',
            logoUrl: null,
            primaryColor: '',
          },
          features: {
            engines: [],
            exportFormats: [],
          },
        };

        vi.mocked(getConfig).mockResolvedValue(mockConfigResponse);

        const config = await api.config.getAgencyConfig();

        expect(config.name).toBe('Project Nomad'); // Falls back to default
        expect(config.logoUrl).toBeUndefined();
        expect(config.branding?.primaryColor).toBe('#1976d2'); // Falls back to default
      });
    });
  });

  describe('spatial module', () => {
    describe('getWeatherStations', () => {
      it('should return empty array (not implemented)', async () => {
        const stations = await api.spatial.getWeatherStations([-120, 50, -110, 60]);
        expect(stations).toEqual([]);
      });
    });

    describe('getFuelTypes', () => {
      it('should return stub fuel types', async () => {
        const bounds: [number, number, number, number] = [-120, 50, -110, 60];
        const data = await api.spatial.getFuelTypes(bounds);

        expect(data.bounds).toEqual(bounds);
        expect(data.fuelTypes.length).toBeGreaterThan(0);
      });
    });
  });

  describe('results module', () => {
    describe('getExportFormats', () => {
      it('should return available export formats', async () => {
        const formats = await api.results.getExportFormats();

        expect(formats.length).toBeGreaterThan(0);
        expect(formats.find(f => f.id === 'geojson')).toBeDefined();
      });
    });
  });
});
