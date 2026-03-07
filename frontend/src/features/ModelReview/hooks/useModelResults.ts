/**
 * useModelResults Hook
 *
 * Fetches and manages model results from the backend API.
 * Uses the openNomad adapter for URL generation to support embedded mode.
 */

import { useState, useCallback, useEffect } from 'react';
import { useOpenNomad } from '../../../openNomad/context';
import type { ModelResultsResponse, OutputItem } from '../types';

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
  const api = useOpenNomad();

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
   * Fetch results from API using the adapter's results.get() method.
   * This ensures ACN adapters can normalize their backend responses.
   */
  const fetchResults = useCallback(async (modelId: string) => {
    setCurrentModelId(modelId);
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      // The adapter's get() returns ModelResults (nominal type), but the actual
      // runtime data includes all fields needed by ModelResultsResponse.
      // ACN adapters normalize their backend response to include these fields.
      const data = await api.results.get(modelId) as unknown as ModelResultsResponse;
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
  }, [api]);

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
   * Get preview URL for a result (via adapter)
   */
  const getPreviewUrl = useCallback((resultId: string) => {
    return api.results.getPreviewUrl(resultId);
  }, [api]);

  /**
   * Get download URL for a result (via adapter)
   */
  const getDownloadUrl = useCallback((resultId: string) => {
    return api.results.getDownloadUrl(resultId);
  }, [api]);

  /**
   * Poll for updates when model is in progress
   */
  useEffect(() => {
    const status = state.results?.executionSummary?.status;
    const shouldPoll =
      currentModelId &&
      status &&
      ['queued', 'initializing', 'running'].includes(status);

    if (!shouldPoll) return;

    const timer = setInterval(() => {
      fetchResults(currentModelId!);
    }, pollInterval);

    return () => clearInterval(timer);
  }, [currentModelId, state.results?.executionSummary?.status, pollInterval, fetchResults]);

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
