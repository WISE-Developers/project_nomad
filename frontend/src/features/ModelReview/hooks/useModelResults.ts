/**
 * useModelResults Hook
 *
 * Fetches and manages model results from the backend API.
 */

import { useState, useCallback, useEffect } from 'react';
import type { ModelResultsResponse, OutputItem } from '../types';

/**
 * API configuration
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

/**
 * Hook state
 */
interface UseModelResultsState {
  results: ModelResultsResponse | null;
  isLoading: boolean;
  error: string | null;
  selectedOutput: OutputItem | null;
}

/**
 * Hook return value
 */
interface UseModelResultsReturn extends UseModelResultsState {
  fetchResults: (modelId: string) => Promise<void>;
  selectOutput: (output: OutputItem | null) => void;
  refetch: () => Promise<void>;
  getPreviewUrl: (resultId: string) => string;
  getDownloadUrl: (resultId: string) => string;
}

/**
 * Hook for fetching and managing model results.
 *
 * @param initialModelId - Optional model ID to fetch on mount
 * @param pollInterval - Optional polling interval in ms for in-progress models (default: 5000)
 */
export function useModelResults(
  initialModelId?: string,
  pollInterval: number = 5000
): UseModelResultsReturn {
  const [state, setState] = useState<UseModelResultsState>({
    results: null,
    isLoading: false,
    error: null,
    selectedOutput: null,
  });

  const [currentModelId, setCurrentModelId] = useState<string | undefined>(
    initialModelId
  );

  /**
   * Fetch results from API
   */
  const fetchResults = useCallback(async (modelId: string) => {
    setCurrentModelId(modelId);
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/v1/models/${modelId}/results`
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.message || `Failed to fetch results: ${response.status}`
        );
      }

      const data: ModelResultsResponse = await response.json();
      setState({
        results: data,
        isLoading: false,
        error: null,
        selectedOutput: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: message,
      }));
    }
  }, []);

  /**
   * Refetch current model results
   */
  const refetch = useCallback(async () => {
    if (currentModelId) {
      await fetchResults(currentModelId);
    }
  }, [currentModelId, fetchResults]);

  /**
   * Select an output for preview
   */
  const selectOutput = useCallback((output: OutputItem | null) => {
    setState((prev) => ({ ...prev, selectedOutput: output }));
  }, []);

  /**
   * Get preview URL for a result
   */
  const getPreviewUrl = useCallback((resultId: string) => {
    return `${API_BASE_URL}/api/v1/results/${resultId}/preview`;
  }, []);

  /**
   * Get download URL for a result
   */
  const getDownloadUrl = useCallback((resultId: string) => {
    return `${API_BASE_URL}/api/v1/results/${resultId}/download`;
  }, []);

  /**
   * Poll for updates when model is in progress
   */
  useEffect(() => {
    const status = state.results?.executionSummary.status;
    const shouldPoll =
      currentModelId &&
      status &&
      ['queued', 'initializing', 'running'].includes(status);

    if (!shouldPoll) return;

    const timer = setInterval(() => {
      fetchResults(currentModelId!);
    }, pollInterval);

    return () => clearInterval(timer);
  }, [currentModelId, state.results?.executionSummary.status, pollInterval, fetchResults]);

  /**
   * Fetch initial model if provided
   */
  useEffect(() => {
    if (initialModelId) {
      fetchResults(initialModelId);
    }
  }, [initialModelId, fetchResults]);

  return {
    ...state,
    fetchResults,
    selectOutput,
    refetch,
    getPreviewUrl,
    getDownloadUrl,
  };
}
