/**
 * Tests for useModelResults consumer migration
 *
 * Verifies that useModelResults uses api.fetch() instead of bare fetch().
 *
 * Expected state: These tests FAIL until the consumer migration is applied.
 * Once useModelResults is updated to call api.fetch(url) instead of fetch(url),
 * these tests should pass.
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

// =============================================================================
// Tests
// =============================================================================

describe('useModelResults - api.fetch() usage', () => {
  let mockApi: IOpenNomadAPI & { fetch: ReturnType<typeof vi.fn> };
  let globalFetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Create a mock api with fetch spy and getBaseUrl
    const baseApi = createMockOpenNomadAPI();
    mockApi = {
      ...baseApi,
      fetch: vi.fn(),
      getBaseUrl: vi.fn().mockReturnValue(''),
      results: {
        ...baseApi.results,
        getModelResultsUrl: vi.fn().mockImplementation(
          (modelId: string) => `/api/v1/models/${modelId}/results`
        ),
        getPreviewUrl: vi.fn().mockImplementation(
          (resultId: string) => `/api/v1/results/${resultId}/preview`
        ),
        getDownloadUrl: vi.fn().mockImplementation(
          (resultId: string) => `/api/v1/results/${resultId}/download`
        ),
      },
    };

    // Set up api.fetch to return a successful response
    mockApi.fetch.mockResolvedValue(
      new Response(JSON.stringify(mockResultsResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    // Set up globalThis.fetch as a spy that should NOT be called
    globalFetchSpy = vi.fn();
    vi.stubGlobal('fetch', globalFetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('calls api.fetch() when fetching results', async () => {
    const { result } = renderHook(
      () => useModelResults(),
      { wrapper: createWrapper(mockApi) }
    );

    await act(async () => {
      await result.current.fetchResults('model-1');
    });

    expect(mockApi.fetch).toHaveBeenCalledTimes(1);
    expect(mockApi.fetch).toHaveBeenCalledWith('/api/v1/models/model-1/results');
  });

  it('does NOT call bare globalThis.fetch directly', async () => {
    const { result } = renderHook(
      () => useModelResults(),
      { wrapper: createWrapper(mockApi) }
    );

    await act(async () => {
      await result.current.fetchResults('model-1');
    });

    // bare fetch must not be called - api.fetch handles it
    expect(globalFetchSpy).not.toHaveBeenCalled();
  });

  it('uses the URL from api.results.getModelResultsUrl()', async () => {
    const { result } = renderHook(
      () => useModelResults(),
      { wrapper: createWrapper(mockApi) }
    );

    await act(async () => {
      await result.current.fetchResults('model-42');
    });

    // getModelResultsUrl must have been called to generate the URL
    expect(mockApi.results.getModelResultsUrl).toHaveBeenCalledWith('model-42');

    // api.fetch must have been called with that URL
    expect(mockApi.fetch).toHaveBeenCalledWith('/api/v1/models/model-42/results');
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
});
