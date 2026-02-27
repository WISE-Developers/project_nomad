/**
 * Tests for useExportGeneration consumer migration
 *
 * Verifies that useExportGeneration uses api.fetch() instead of bare fetch().
 *
 * Expected state: These tests FAIL until the consumer migration is applied.
 * Once useExportGeneration is updated to call api.fetch() instead of fetch(),
 * these tests should pass.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { OpenNomadProvider } from '../../../../openNomad/context';
import { createMockOpenNomadAPI } from '../../../../test/mocks/openNomad';
import { useExportGeneration } from '../useExportGeneration';
import type { IOpenNomadAPI } from '../../../../openNomad/api';
import type { ExportRequest } from '../../types';

// =============================================================================
// Test helpers
// =============================================================================

function createWrapper(api: IOpenNomadAPI) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(OpenNomadProvider, { adapter: api }, children);
  };
}

const mockExportRequest: ExportRequest = {
  modelId: 'model-1',
  modelName: 'Test Model',
  items: [{ resultId: 'result-1', format: 'geojson' }],
};

const mockExportResponse = {
  exportId: 'export-abc123',
  manifest: {
    modelName: 'Test Model',
    modelId: 'model-1',
    createdAt: '2024-01-01T12:00:00Z',
    itemCount: 1,
    totalSize: 1024,
    items: [{ name: 'fire_perimeter.geojson', format: 'geojson', size: 1024 }],
  },
};

const mockShareResponse = {
  shareUrl: 'https://nomad.example.com/share/abc123',
  token: 'abc123',
  expiresAt: '2024-01-08T12:00:00Z',
  maxDownloads: 10,
};

// =============================================================================
// Tests
// =============================================================================

describe('useExportGeneration - api.fetch() usage', () => {
  let mockApi: IOpenNomadAPI & { fetch: ReturnType<typeof vi.fn> };
  let globalFetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const baseApi = createMockOpenNomadAPI();
    mockApi = {
      ...baseApi,
      fetch: vi.fn(),
      getBaseUrl: vi.fn().mockReturnValue(''),
    };

    // Default: return successful export creation response
    mockApi.fetch.mockResolvedValue(
      new Response(JSON.stringify(mockExportResponse), {
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

  it('calls api.fetch() when generating an export bundle', async () => {
    const { result } = renderHook(
      () => useExportGeneration(),
      { wrapper: createWrapper(mockApi) }
    );

    await act(async () => {
      await result.current.generate(mockExportRequest, 'download');
    });

    expect(mockApi.fetch).toHaveBeenCalled();
    // The first call should be to create the export
    const [url] = mockApi.fetch.mock.calls[0];
    expect(url).toContain('/exports');
  });

  it('does NOT call bare globalThis.fetch directly when generating', async () => {
    const { result } = renderHook(
      () => useExportGeneration(),
      { wrapper: createWrapper(mockApi) }
    );

    await act(async () => {
      await result.current.generate(mockExportRequest, 'download');
    });

    // bare fetch must not be called - api.fetch handles it
    expect(globalFetchSpy).not.toHaveBeenCalled();
  });

  it('calls api.fetch() for share link creation when delivery is "share"', async () => {
    // First call: export creation; second call: share link creation
    mockApi.fetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockExportResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockShareResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    const { result } = renderHook(
      () => useExportGeneration(),
      { wrapper: createWrapper(mockApi) }
    );

    await act(async () => {
      await result.current.generate(mockExportRequest, 'share');
    });

    // api.fetch should have been called twice (create + share)
    expect(mockApi.fetch).toHaveBeenCalledTimes(2);

    // Second call should be to the share endpoint
    const [shareUrl] = mockApi.fetch.mock.calls[1];
    expect(shareUrl).toContain(`/exports/${mockExportResponse.exportId}/share`);
  });

  it('uses api.getBaseUrl() for constructing export URLs', async () => {
    // Reconfigure with a non-empty base URL
    mockApi.getBaseUrl.mockReturnValue('https://api.agency.gov/nomad');

    const { result } = renderHook(
      () => useExportGeneration(),
      { wrapper: createWrapper(mockApi) }
    );

    await act(async () => {
      await result.current.generate(mockExportRequest, 'download');
    });

    // api.fetch must have been called at least once for this test to be meaningful
    expect(mockApi.fetch).toHaveBeenCalled();

    // The URL used in api.fetch should include the base URL
    const firstCall = mockApi.fetch.mock.calls[0];
    const url = firstCall?.[0] as string;
    expect(url).toContain('https://api.agency.gov/nomad');
    expect(url).toContain('/exports');
  });

  it('sets exportId in state after successful generation', async () => {
    const { result } = renderHook(
      () => useExportGeneration(),
      { wrapper: createWrapper(mockApi) }
    );

    let returnedId: string | null = null;
    await act(async () => {
      returnedId = await result.current.generate(mockExportRequest, 'download');
    });

    expect(returnedId).toBe('export-abc123');
    expect(result.current.exportId).toBe('export-abc123');
    expect(result.current.state).toBe('complete');
    expect(result.current.error).toBeNull();
  });
});
