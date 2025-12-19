/**
 * useModels Hook
 *
 * Provides model data and operations for the Dashboard.
 * Uses the openNomad API internally and integrates with DashboardContext.
 *
 * @module features/Dashboard/hooks
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useOpenNomad } from '../../../openNomad/index.js';
import { useDashboard } from '../context/DashboardContext.js';
import type {
  Model,
  ModelFilter,
  ModelStatus,
  PaginationParams,
} from '../../../openNomad/api.js';
import type { ModelSortOption, ModelFilterOptions } from '../context/DashboardContext.js';

// =============================================================================
// Types
// =============================================================================

export interface UseModelsOptions {
  /** Auto-refresh interval in ms (0 to disable) */
  refreshInterval?: number;
  /** Whether to automatically fetch on mount */
  autoFetch?: boolean;
  /** Initial pagination */
  pagination?: PaginationParams;
}

export interface UseModelsReturn {
  /** Current models (filtered and sorted) */
  models: Model[];
  /** Total models matching current filters */
  total: number;
  /** Whether models are loading */
  isLoading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** When data was last fetched */
  lastFetched: number | null;
  /** Current page info */
  pagination: {
    page: number;
    limit: number;
    totalPages: number;
  };
  /** Current sort state */
  sort: {
    by: ModelSortOption;
    direction: 'asc' | 'desc';
  };
  /** Current filters */
  filters: ModelFilterOptions;

  // Actions
  /** Refresh models from API */
  refresh: () => Promise<void>;
  /** Fetch a single model by ID */
  getModel: (id: string) => Promise<Model>;
  /** Delete a model by ID */
  deleteModel: (id: string) => Promise<void>;
  /** Delete multiple models */
  deleteModels: (ids: string[]) => Promise<void>;
  /** Get model status */
  getStatus: (id: string) => Promise<ModelStatus>;
  /** Set filters */
  setFilters: (filters: ModelFilterOptions) => void;
  /** Set sort */
  setSort: (by: ModelSortOption, direction?: 'asc' | 'desc') => void;
  /** Go to page */
  setPage: (page: number) => void;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Sort models by field
 */
function sortModels(
  models: Model[],
  sortBy: ModelSortOption,
  direction: 'asc' | 'desc'
): Model[] {
  const sorted = [...models].sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case 'createdAt':
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
      case 'updatedAt':
        comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
        break;
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'status': {
        const statusOrder: Record<ModelStatus, number> = {
          running: 0,
          queued: 1,
          completed: 2,
          failed: 3,
          draft: 4,
        };
        comparison = statusOrder[a.status] - statusOrder[b.status];
        break;
      }
    }

    return direction === 'desc' ? -comparison : comparison;
  });

  return sorted;
}

/**
 * Filter models client-side (for additional filtering beyond API)
 */
function filterModels(models: Model[], filters: ModelFilterOptions): Model[] {
  return models.filter((model) => {
    // Filter by status
    if (filters.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      if (!statuses.includes(model.status)) {
        return false;
      }
    }

    // Filter by engine
    if (filters.engine && model.engine !== filters.engine) {
      return false;
    }

    // Filter by search query
    if (filters.search) {
      const query = filters.search.toLowerCase();
      const matchesName = model.name.toLowerCase().includes(query);
      const matchesNotes = model.notes?.toLowerCase().includes(query);
      const matchesId = model.id.toLowerCase().includes(query);
      if (!matchesName && !matchesNotes && !matchesId) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Convert dashboard filters to API filters
 */
function toApiFilters(filters: ModelFilterOptions): ModelFilter {
  return {
    status: filters.status,
    engine: filters.engine,
    search: filters.search,
  };
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for managing models in the Dashboard.
 *
 * Uses openNomad API and integrates with DashboardContext for state management.
 */
export function useModels(options: UseModelsOptions = {}): UseModelsReturn {
  const {
    refreshInterval = 0,
    autoFetch = true,
    pagination: initialPagination = { page: 1, limit: 20 },
  } = options;

  // API access
  const api = useOpenNomad();

  // Dashboard context
  const { state, dispatch } = useDashboard();

  // Local pagination state (not in context since it's view-specific)
  const [page, setPage] = useState(initialPagination.page ?? 1);
  const [limit] = useState(initialPagination.limit ?? 20);
  const [total, setTotal] = useState(0);

  // Track mounted state to prevent state updates after unmount
  const mountedRef = useRef(true);

  // Fetch models from API
  const fetchModels = useCallback(async () => {
    if (!mountedRef.current) return;

    dispatch({ type: 'SET_MODELS_LOADING', loading: { isLoading: true, error: null } });

    try {
      const apiFilters = toApiFilters(state.modelFilters);
      const result = await api.models.list(apiFilters, { page, limit });

      if (!mountedRef.current) return;

      dispatch({ type: 'SET_MODELS', models: result.data });
      setTotal(result.total);
      dispatch({
        type: 'SET_MODELS_LOADING',
        loading: { isLoading: false, error: null, lastFetched: Date.now() },
      });
    } catch (err) {
      if (!mountedRef.current) return;

      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch models';
      dispatch({
        type: 'SET_MODELS_LOADING',
        loading: { isLoading: false, error: errorMessage },
      });
    }
  }, [api, dispatch, state.modelFilters, page, limit]);

  // Get a single model
  const getModelById = useCallback(async (id: string): Promise<Model> => {
    return api.models.get(id);
  }, [api]);

  // Delete a model
  const deleteModel = useCallback(async (id: string): Promise<void> => {
    await api.models.delete(id);
    dispatch({ type: 'REMOVE_MODEL', id });
  }, [api, dispatch]);

  // Delete multiple models
  const deleteModels = useCallback(async (ids: string[]): Promise<void> => {
    // Delete in parallel
    await Promise.all(ids.map((id) => api.models.delete(id)));
    // Remove from state
    for (const id of ids) {
      dispatch({ type: 'REMOVE_MODEL', id });
    }
  }, [api, dispatch]);

  // Get model status
  const getModelStatus = useCallback(async (id: string): Promise<ModelStatus> => {
    const model = await api.models.get(id);
    return model.status;
  }, [api]);

  // Set filters
  const setFilters = useCallback((filters: ModelFilterOptions) => {
    dispatch({ type: 'SET_MODEL_FILTERS', filters });
    setPage(1); // Reset to first page on filter change
  }, [dispatch]);

  // Set sort
  const setSort = useCallback((by: ModelSortOption, direction?: 'asc' | 'desc') => {
    dispatch({ type: 'SET_MODEL_SORT', sortBy: by, direction });
  }, [dispatch]);

  // Initial fetch
  useEffect(() => {
    if (autoFetch) {
      fetchModels();
    }
  }, [autoFetch, fetchModels]);

  // Auto-refresh
  useEffect(() => {
    if (refreshInterval <= 0) return;

    const interval = setInterval(fetchModels, refreshInterval);
    return () => clearInterval(interval);
  }, [refreshInterval, fetchModels]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Apply client-side filtering and sorting
  const processedModels = sortModels(
    filterModels(state.models, state.modelFilters),
    state.modelSortBy,
    state.modelSortDirection
  );

  return {
    models: processedModels,
    total,
    isLoading: state.modelsLoading.isLoading,
    error: state.modelsLoading.error,
    lastFetched: state.modelsLoading.lastFetched,
    pagination: {
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
    sort: {
      by: state.modelSortBy,
      direction: state.modelSortDirection,
    },
    filters: state.modelFilters,

    refresh: fetchModels,
    getModel: getModelById,
    deleteModel,
    deleteModels,
    getStatus: getModelStatus,
    setFilters,
    setSort,
    setPage,
  };
}
