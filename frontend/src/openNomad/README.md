# openNomad API - Agency Integration Guide

This guide explains how to integrate the Nomad Dashboard into your agency's existing application (ACN mode).

## Overview

The openNomad API is an abstraction layer that allows the Dashboard component to communicate with any backend. Your agency creates an **adapter** that implements the `IOpenNomadAPI` interface, connecting the Dashboard to your existing services.

```
┌─────────────────────────────────────────────────────────────────┐
│                     Your Agency Application                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   OpenNomadProvider                      │    │
│  │        (wraps Dashboard with your adapter)               │    │
│  │  ┌─────────────────────────────────────────────────┐    │    │
│  │  │              DashboardContainer                  │    │    │
│  │  │                mode="embedded"                   │    │    │
│  │  └─────────────────────────────────────────────────┘    │    │
│  └──────────────────────────┬──────────────────────────────┘    │
│                             │                                    │
│                             ▼                                    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Your Agency Adapter                         │    │
│  │         (implements IOpenNomadAPI)                       │    │
│  └──────────────────────────┬──────────────────────────────┘    │
│                             │                                    │
└─────────────────────────────┼────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │   Your Agency Backend APIs     │
              │   (Auth, Models, Spatial, etc) │
              └───────────────────────────────┘
```

## Quick Start

### 1. Install Dependencies

The Dashboard is distributed as part of the Nomad frontend package:

```bash
npm install @nomad/frontend
# or include as a git submodule
```

### 2. Create Your Agency Adapter

Create a file that implements the `IOpenNomadAPI` interface:

```typescript
// src/adapters/myAgencyAdapter.ts
import type { IOpenNomadAPI } from '@nomad/openNomad';

export function createMyAgencyAdapter(authToken: string): IOpenNomadAPI {
  return {
    auth: createAuthModule(authToken),
    models: createModelsModule(authToken),
    jobs: createJobsModule(authToken),
    results: createResultsModule(authToken),
    spatial: createSpatialModule(authToken),
    config: createConfigModule(),
  };
}
```

### 3. Embed the Dashboard

```tsx
import { OpenNomadProvider, DashboardContainer } from '@nomad/openNomad';
import { createMyAgencyAdapter } from './adapters/myAgencyAdapter';

function MyAgencyApp() {
  // Get auth token from your existing auth system
  const { authToken } = useMyAgencyAuth();

  // Create adapter with auth token
  const adapter = useMemo(
    () => createMyAgencyAdapter(authToken),
    [authToken]
  );

  return (
    <OpenNomadProvider adapter={adapter}>
      <DashboardContainer
        mode="embedded"
        onLaunchWizard={(draftId) => {
          // Handle launching model wizard
        }}
        onViewResults={(modelId) => {
          // Handle viewing model results
        }}
      />
    </OpenNomadProvider>
  );
}
```

## Implementing the Adapter

The `IOpenNomadAPI` interface has 6 modules. Each module connects to your backend services.

### Auth Module

Connects the Dashboard to your agency's authentication system.

```typescript
import type { IOpenNomadAPI, User } from '@nomad/openNomad';

function createAuthModule(authToken: string): IOpenNomadAPI['auth'] {
  return {
    async getCurrentUser(): Promise<User | null> {
      // Decode your JWT or fetch user from your auth API
      const response = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!response.ok) return null;

      const userData = await response.json();
      return {
        id: userData.id,
        name: userData.displayName,
        email: userData.email,
        role: mapAgencyRoleToNomadRole(userData.role),
        agencyId: userData.agencyCode,
      };
    },

    async getAuthToken(): Promise<string | null> {
      // Return the token for API calls
      return authToken;
    },

    onAuthChange(callback: (user: User | null) => void): () => void {
      // Subscribe to your auth state changes
      const unsubscribe = myAuthService.onStateChange((state) => {
        callback(state.user ? mapToNomadUser(state.user) : null);
      });
      return unsubscribe;
    },
  };
}

// Map your agency roles to Nomad roles
function mapAgencyRoleToNomadRole(agencyRole: string): UserRole {
  const roleMap: Record<string, UserRole> = {
    'fire_behavior_analyst': 'fban',
    'modeler': 'modeler',
    'viewer': 'user',
    'admin': 'admin',
  };
  return roleMap[agencyRole] ?? 'user';
}
```

### Models Module

Connects to your model storage system (could be Nomad backend or agency database).

```typescript
function createModelsModule(authToken: string): IOpenNomadAPI['models'] {
  const headers = { Authorization: `Bearer ${authToken}` };

  return {
    async create(params: ModelCreateParams): Promise<Model> {
      const response = await fetch('/api/nomad/models', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      return mapToNomadModel(await response.json());
    },

    async list(filter?: ModelFilter, pagination?: PaginationParams): Promise<PaginatedResponse<Model>> {
      const params = new URLSearchParams();
      if (filter?.status) params.set('status', String(filter.status));
      if (filter?.engine) params.set('engine', filter.engine);
      if (filter?.search) params.set('search', filter.search);
      if (pagination?.page) params.set('page', String(pagination.page));
      if (pagination?.limit) params.set('limit', String(pagination.limit));

      const response = await fetch(`/api/nomad/models?${params}`, { headers });
      const data = await response.json();

      return {
        data: data.models.map(mapToNomadModel),
        total: data.total,
        page: data.page,
        limit: data.limit,
        totalPages: data.totalPages,
      };
    },

    async get(id: string): Promise<Model> {
      const response = await fetch(`/api/nomad/models/${id}`, { headers });
      return mapToNomadModel(await response.json());
    },

    async update(id: string, updates: Partial<ModelCreateParams>): Promise<Model> {
      const response = await fetch(`/api/nomad/models/${id}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      return mapToNomadModel(await response.json());
    },

    async delete(id: string): Promise<void> {
      await fetch(`/api/nomad/models/${id}`, {
        method: 'DELETE',
        headers,
      });
    },

    async getStatus(id: string): Promise<ModelStatus> {
      const model = await this.get(id);
      return model.status;
    },
  };
}
```

### Jobs Module

Handles model execution tracking. Consider using WebSocket for real-time updates.

```typescript
function createJobsModule(authToken: string): IOpenNomadAPI['jobs'] {
  const headers = { Authorization: `Bearer ${authToken}` };
  const activeSubscriptions = new Map<string, WebSocket>();

  return {
    async submit(modelId: string): Promise<Job> {
      const response = await fetch(`/api/nomad/models/${modelId}/execute`, {
        method: 'POST',
        headers,
      });
      return mapToNomadJob(await response.json());
    },

    async cancel(jobId: string): Promise<void> {
      await fetch(`/api/nomad/jobs/${jobId}/cancel`, {
        method: 'POST',
        headers,
      });
    },

    async getStatus(jobId: string): Promise<JobStatusDetail> {
      const response = await fetch(`/api/nomad/jobs/${jobId}`, { headers });
      return mapToJobStatusDetail(await response.json());
    },

    onStatusChange(jobId: string, callback: (status: JobStatusDetail) => void): () => void {
      // Option 1: WebSocket (preferred for real-time)
      const ws = new WebSocket(`wss://your-api/jobs/${jobId}/stream`);
      ws.onmessage = (event) => {
        callback(mapToJobStatusDetail(JSON.parse(event.data)));
      };
      activeSubscriptions.set(jobId, ws);

      return () => {
        ws.close();
        activeSubscriptions.delete(jobId);
      };

      // Option 2: Polling (fallback)
      // See DefaultOpenNomadAPI.ts for polling implementation
    },
  };
}
```

### Spatial Module

Connects to your agency's spatial data services (WFS, WCS, etc.).

```typescript
function createSpatialModule(authToken: string): IOpenNomadAPI['spatial'] {
  const headers = { Authorization: `Bearer ${authToken}` };

  return {
    async getWeatherStations(bounds: BBox): Promise<WeatherStation[]> {
      // Query your agency's weather station WFS
      const [minLng, minLat, maxLng, maxLat] = bounds;
      const response = await fetch(
        `/api/spatial/weather-stations?bbox=${minLng},${minLat},${maxLng},${maxLat}`,
        { headers }
      );
      return (await response.json()).stations;
    },

    async getFuelTypes(bounds: BBox): Promise<FuelTypeData> {
      // Return info about your agency's fuel type WCS/WMS service
      return {
        bounds,
        fuelTypes: [
          { code: 'C-2', name: 'Boreal Spruce', color: '#228B22' },
          { code: 'M-1', name: 'Boreal Mixedwood', color: '#90EE90' },
          // ... your fuel type legend
        ],
        serviceUrl: 'https://your-agency-geoserver/wcs/fuels',
        serviceType: 'wcs',
      };
    },

    async getElevation(bounds: BBox): Promise<ElevationData> {
      return {
        bounds,
        serviceUrl: 'https://your-agency-geoserver/wcs/dem',
        serviceType: 'wcs',
        resolution: 30, // meters
      };
    },
  };
}
```

### Config Module

Returns agency-specific configuration and branding.

```typescript
function createConfigModule(): IOpenNomadAPI['config'] {
  return {
    async getAvailableEngines(): Promise<Engine[]> {
      return [
        {
          id: 'firestarr',
          name: 'FireSTARR',
          description: 'Probabilistic fire spread model',
          available: true,
          capabilities: {
            probabilistic: true,
            deterministic: true,
            ignitionTypes: ['point', 'line', 'polygon'],
            maxDurationHours: 720,
          },
        },
        // Add WISE if your agency supports it
      ];
    },

    async getAgencyConfig(): Promise<AgencyConfig> {
      return {
        id: 'my-agency',
        name: 'My Agency Fire Management',
        branding: {
          primaryColor: '#1a5f2a',
          logoUrl: '/assets/agency-logo.png',
        },
        features: {
          enableExport: true,
          enableSharing: true,
          maxConcurrentModels: 5,
        },
        defaultEngine: 'firestarr',
      };
    },
  };
}
```

### Results Module

Handles model output retrieval and export.

```typescript
function createResultsModule(authToken: string): IOpenNomadAPI['results'] {
  const headers = { Authorization: `Bearer ${authToken}` };

  return {
    async get(modelId: string): Promise<ModelResults> {
      const response = await fetch(`/api/nomad/models/${modelId}/results`, { headers });
      return await response.json();
    },

    async getData(resultId: string): Promise<GeoJSONGeometry | string> {
      const response = await fetch(`/api/nomad/results/${resultId}/data`, { headers });
      const contentType = response.headers.get('content-type');

      if (contentType?.includes('application/json')) {
        return await response.json(); // GeoJSON
      }
      return response.url; // Raster URL
    },

    async export(modelId: string, params: ExportParams): Promise<Blob> {
      const response = await fetch(`/api/nomad/models/${modelId}/export`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      return await response.blob();
    },

    async getExportFormats(): Promise<ExportFormat[]> {
      return [
        { id: 'geojson', name: 'GeoJSON', extension: 'geojson', category: 'vector', supportedOutputTypes: ['perimeter', 'probability'] },
        { id: 'shapefile', name: 'Shapefile', extension: 'shp', category: 'vector', supportedOutputTypes: ['perimeter'] },
        { id: 'geotiff', name: 'GeoTIFF', extension: 'tif', category: 'raster', supportedOutputTypes: ['probability', 'intensity'] },
      ];
    },
  };
}
```

## DashboardContainer Props

The `DashboardContainer` component accepts the following props:

| Prop | Type | Description |
|------|------|-------------|
| `mode` | `'floating' \| 'embedded'` | Display mode. Use `'embedded'` for ACN. |
| `onClose` | `() => void` | Called when close button clicked (floating mode). |
| `onLaunchWizard` | `(draftId?: string) => void` | Called when user wants to create/resume a model. |
| `onViewResults` | `(modelId: string) => void` | Called when user wants to view model results. |
| `onAddToMap` | `(modelId: string) => void` | Called when user wants to add results to map. |
| `initialTab` | `'models' \| 'drafts' \| 'jobs'` | Initial tab to display. |
| `className` | `string` | Additional CSS class for styling. |

## Styling the Embedded Dashboard

The Dashboard uses inline styles by default. To customize appearance:

```css
/* Override Dashboard styles */
.dashboard-embedded {
  border: 1px solid #your-border-color;
  border-radius: 8px;
}

.dashboard-embedded h2 {
  color: #your-header-color;
}
```

Or pass a className and style completely:

```tsx
<DashboardContainer
  mode="embedded"
  className="my-agency-dashboard"
/>
```

## Type Reference

All types are exported from `@nomad/openNomad`:

```typescript
import type {
  // Core interface
  IOpenNomadAPI,

  // Auth
  User,
  UserRole,

  // Models
  Model,
  ModelStatus,
  ModelCreateParams,
  ModelFilter,
  EngineType,

  // Jobs
  Job,
  JobStatus,
  JobStatusDetail,

  // Results
  ModelResults,
  ModelResult,
  ExportFormat,
  ExportParams,

  // Spatial
  BBox,
  WeatherStation,
  FuelTypeData,
  ElevationData,

  // Config
  Engine,
  AgencyConfig,

  // Utilities
  PaginationParams,
  PaginatedResponse,
  Unsubscribe,
} from '@nomad/openNomad';
```

## Testing Your Adapter

Create a test file to verify your adapter works:

```typescript
import { describe, it, expect } from 'vitest';
import { createMyAgencyAdapter } from './myAgencyAdapter';

describe('MyAgencyAdapter', () => {
  const adapter = createMyAgencyAdapter('test-token');

  it('should implement all required modules', () => {
    expect(adapter.auth).toBeDefined();
    expect(adapter.models).toBeDefined();
    expect(adapter.jobs).toBeDefined();
    expect(adapter.results).toBeDefined();
    expect(adapter.spatial).toBeDefined();
    expect(adapter.config).toBeDefined();
  });

  it('should return available engines', async () => {
    const engines = await adapter.config.getAvailableEngines();
    expect(engines.length).toBeGreaterThan(0);
    expect(engines[0].id).toBe('firestarr');
  });

  // Add more tests for each module...
});
```

## Troubleshooting

### Dashboard shows "useOpenNomad must be used within OpenNomadProvider"

Ensure the Dashboard is wrapped with `OpenNomadProvider`:

```tsx
// Wrong
<DashboardContainer mode="embedded" />

// Correct
<OpenNomadProvider adapter={myAdapter}>
  <DashboardContainer mode="embedded" />
</OpenNomadProvider>
```

### Auth token not being passed to API calls

Make sure your adapter captures the token in closure:

```typescript
// Wrong - token undefined
function createAdapter() {
  return {
    models: {
      async list() {
        // authToken is undefined here!
      }
    }
  };
}

// Correct - token captured
function createAdapter(authToken: string) {
  return {
    models: {
      async list() {
        // authToken available via closure
        const response = await fetch('/api', {
          headers: { Authorization: `Bearer ${authToken}` }
        });
      }
    }
  };
}
```

### Models not updating after changes

The Dashboard caches data. Call `refresh()` or update the adapter when data changes:

```typescript
// In your adapter, invalidate cache when needed
const modelsCache = new Map();

async function list() {
  if (modelsCache.has('list')) {
    return modelsCache.get('list');
  }
  // ... fetch and cache
}

function invalidateCache() {
  modelsCache.clear();
}
```

## Reference Implementation

See `/frontend/src/openNomad/default/DefaultOpenNomadAPI.ts` for the complete SAN mode implementation. This file is heavily commented and serves as a template for agency adapters.

## Support

- GitHub Issues: [WISE-Developers/project_nomad](https://github.com/WISE-Developers/project_nomad/issues)
- Slack: #nomad-integration
