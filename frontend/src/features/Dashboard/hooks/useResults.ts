/**
 * useResults Hook
 *
 * Provides result retrieval and export functionality for the Dashboard.
 * Uses the openNomad API for result data access.
 *
 * @module features/Dashboard/hooks
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useOpenNomad } from '../../../openNomad/index.js';
import type {
  ModelResults,
  ModelResult,
  ExportFormat,
  ExportParams,
  GeoJSONGeometry,
} from '../../../openNomad/api.js';

// =============================================================================
// Types
// =============================================================================

export interface UseResultsOptions {
  /** Model ID to fetch results for */
  modelId?: string;
  /** Whether to auto-fetch on mount/modelId change */
  autoFetch?: boolean;
}

export interface UseResultsReturn {
  /** Results data for the model */
  results: ModelResults | null;
  /** Available export formats */
  exportFormats: ExportFormat[];
  /** Whether results are loading */
  isLoading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Whether there are any results */
  hasResults: boolean;
  /** List of result items */
  resultItems: ModelResult[];

  // Actions
  /** Fetch results for a model */
  fetchResults: (modelId: string) => Promise<ModelResults>;
  /** Get data for a specific result */
  getResultData: (resultId: string) => Promise<GeoJSONGeometry | string>;
  /** Export results */
  exportResults: (modelId: string, params: ExportParams) => Promise<Blob>;
  /** Refresh export formats */
  refreshExportFormats: () => Promise<void>;
  /** Clear current results */
  clearResults: () => void;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for managing model results in the Dashboard.
 *
 * Provides methods for fetching results, getting result data, and exporting.
 */
export function useResults(options: UseResultsOptions = {}): UseResultsReturn {
  const { modelId, autoFetch = true } = options;

  // API access
  const api = useOpenNomad();

  // State
  const [results, setResults] = useState<ModelResults | null>(null);
  const [exportFormats, setExportFormats] = useState<ExportFormat[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track mounted state
  const mountedRef = useRef(true);

  // ==========================================================================
  // Fetch Results
  // ==========================================================================

  const fetchResults = useCallback(async (id: string): Promise<ModelResults> => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await api.results.get(id);
      if (mountedRef.current) {
        setResults(data);
      }
      return data;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch results';
      if (mountedRef.current) {
        setError(errorMessage);
      }
      throw err;
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [api]);

  // ==========================================================================
  // Get Result Data
  // ==========================================================================

  const getResultData = useCallback(async (resultId: string): Promise<GeoJSONGeometry | string> => {
    return api.results.getData(resultId);
  }, [api]);

  // ==========================================================================
  // Export Results
  // ==========================================================================

  const exportResults = useCallback(async (id: string, params: ExportParams): Promise<Blob> => {
    return api.results.export(id, params);
  }, [api]);

  // ==========================================================================
  // Export Formats
  // ==========================================================================

  const refreshExportFormats = useCallback(async () => {
    try {
      const formats = await api.results.getExportFormats();
      if (mountedRef.current) {
        setExportFormats(formats);
      }
    } catch (err) {
      console.error('Failed to fetch export formats:', err);
    }
  }, [api]);

  // ==========================================================================
  // Clear Results
  // ==========================================================================

  const clearResults = useCallback(() => {
    setResults(null);
    setError(null);
  }, []);

  // ==========================================================================
  // Auto-fetch
  // ==========================================================================

  // Fetch results when modelId changes
  useEffect(() => {
    if (autoFetch && modelId) {
      fetchResults(modelId);
    }
  }, [autoFetch, modelId, fetchResults]);

  // Load export formats on mount
  useEffect(() => {
    refreshExportFormats();
  }, [refreshExportFormats]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ==========================================================================
  // Computed Values
  // ==========================================================================

  const resultItems = results?.results ?? [];
  const hasResults = resultItems.length > 0;

  return {
    results,
    exportFormats,
    isLoading,
    error,
    hasResults,
    resultItems,

    fetchResults,
    getResultData,
    exportResults,
    refreshExportFormats,
    clearResults,
  };
}

// =============================================================================
// Utility Hook: Single Result Viewer
// =============================================================================

export interface UseResultViewerOptions {
  /** Whether to auto-fetch data */
  autoFetch?: boolean;
}

/**
 * Hook for viewing a single result's data.
 *
 * Useful for components that display one specific result.
 */
export function useResultViewer(
  resultId: string | null,
  options: UseResultViewerOptions = {}
) {
  const { autoFetch = true } = options;

  const api = useOpenNomad();
  const [data, setData] = useState<GeoJSONGeometry | string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    if (!resultId) return;

    setIsLoading(true);
    setError(null);

    try {
      const resultData = await api.results.getData(resultId);
      if (mountedRef.current) {
        setData(resultData);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch result data';
      if (mountedRef.current) {
        setError(errorMessage);
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [resultId, api]);

  // Auto-fetch
  useEffect(() => {
    if (autoFetch && resultId) {
      fetchData();
    }
  }, [autoFetch, resultId, fetchData]);

  // Cleanup
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return {
    data,
    isLoading,
    error,
    isGeoJSON: data && typeof data === 'object',
    isUrl: data && typeof data === 'string',
    refresh: fetchData,
  };
}
