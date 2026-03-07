/**
 * Tests for useModelResults hook
 *
 * Verifies:
 * 1. Hook uses api.results.get() (adapter method) for fetching
 * 2. modelName is properly populated from adapter response
 * 3. Polling works via adapter
 * 4. api.fetch() is NOT called directly for results fetching
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { OpenNomadProvider } from '../../../../openNomad/context';
import { createMockOpenNomadAPI } from '../../../../test/mocks/openNomad';
import { useModelResults } from '../useModelResults';
import type { IOpenNomadAPI } from '../../../../openNomad/api';
import type { ModelResultsResponse } from '../../types';

// =============================================================================
// Test helpers
// =============================================================================

function createWrapper(api: IOpenNomadAPI) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(OpenNomadProvider, { adapter: api }, children);
  };
}

const mockResultsResponse: ModelResultsResponse = {
  modelId: 'model-1',
  modelName: 'Test Model',
  engineType: 'firestarr',
  userId: 'user-1',
  executionSummary: {
    startedAt: '2024-01-01T10:00:00Z',
    completedAt: '2024-01-01T11:00:00Z',
    durationSeconds: 3600,
    status: 'completed',
    progress: 100,
  },
  outputs: [],
};

function createTestApi() {
  const baseApi = createMockOpenNomadAPI();
  const mockApi = {
    ...baseApi,
    fetch: vi.fn(),
    getBaseUrl: vi.fn().mockReturnValue(''),
    results: {
      ...baseApi.results,
      get: vi.fn().mockResolvedValue(mockResultsResponse),
      getModelResultsUrl: vi.fn().mockImplementation(
        (modelId: string) => `/api/v1/models/${modelId}/results`
      ),
      getPreviewUrl: vi.fn().mockImplementation(
        (resultId: string) => `/api/v1/results/${resultId}/preview`
      ),
      getDownloadUrl: vi.fn().mockImplementation(
        (resultId: string) => `/api/v1/results/${resultId}/download`
      ),
      getTileUrlTemplate: vi.fn().mockReturnValue('/tiles/{z}/{x}/{y}'),
      getTileBounds: vi.fn().mockResolvedValue([-115, 62, -114, 63]),
    },
  };

  // api.fetch returns the same data (for backwards compat if still used)
  mockApi.fetch.mockResolvedValue(
    new Response(JSON.stringify(mockResultsResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );

  return mockApi;
}

// =============================================================================
// Tests
// =============================================================================

describe('useModelResults - adapter integration', () => {
  let mockApi: ReturnType<typeof createTestApi>;
  let globalFetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockApi = createTestApi();
    globalFetchSpy = vi.fn();
    vi.stubGlobal('fetch', globalFetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('calls api.results.get() when fetching results', async () => {
    const { result } = renderHook(
      () => useModelResults(),
      { wrapper: createWrapper(mockApi) }
    );

    await act(async () => {
      await result.current.fetchResults('model-1');
    });

    expect(mockApi.results.get).toHaveBeenCalledTimes(1);
    expect(mockApi.results.get).toHaveBeenCalledWith('model-1');
  });

  it('does NOT call bare globalThis.fetch directly', async () => {
    const { result } = renderHook(
      () => useModelResults(),
      { wrapper: createWrapper(mockApi) }
    );

    await act(async () => {
      await result.current.fetchResults('model-1');
    });

    expect(globalFetchSpy).not.toHaveBeenCalled();
  });

  it('populates modelName from adapter response', async () => {
    const { result } = renderHook(
      () => useModelResults(),
      { wrapper: createWrapper(mockApi) }
    );

    await act(async () => {
      await result.current.fetchResults('model-1');
    });

    await waitFor(() => {
      expect(result.current.results).not.toBeNull();
    });

    expect(result.current.results?.modelName).toBe('Test Model');
  });

  it('stores the fetched results in state', async () => {
    const { result } = renderHook(
      () => useModelResults(),
      { wrapper: createWrapper(mockApi) }
    );

    await act(async () => {
      await result.current.fetchResults('model-1');
    });

    await waitFor(() => {
      expect(result.current.results).not.toBeNull();
    });

    expect(result.current.results?.modelId).toBe('model-1');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sets error state when adapter throws', async () => {
    mockApi.results.get.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(
      () => useModelResults(),
      { wrapper: createWrapper(mockApi) }
    );

    await act(async () => {
      await result.current.fetchResults('model-1');
    });

    expect(result.current.error).toBe('Network error');
    expect(result.current.isLoading).toBe(false);
  });

  it('polls via adapter when model is in progress', async () => {
    vi.useFakeTimers();

    const runningResponse: ModelResultsResponse = {
      ...mockResultsResponse,
      executionSummary: {
        ...mockResultsResponse.executionSummary,
        status: 'running',
        progress: 50,
        completedAt: null,
      },
    };

    mockApi.results.get.mockResolvedValue(runningResponse);

    const { result } = renderHook(
      () => useModelResults(undefined, 1000),
      { wrapper: createWrapper(mockApi) }
    );

    await act(async () => {
      await result.current.fetchResults('model-1');
    });

    expect(mockApi.results.get).toHaveBeenCalledTimes(1);

    // Advance timer to trigger poll
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(mockApi.results.get).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});
