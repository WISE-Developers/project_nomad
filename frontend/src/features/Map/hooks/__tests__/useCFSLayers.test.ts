/**
 * Tests for useCFSLayers hook
 *
 * Verifies CFS FireSTARR WMS layer configuration:
 * - Returns empty state when no API key configured
 * - Returns available layers when key exists
 * - Builds correct WMS URL with authkey and TIME params
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useCFSLayers } from '../useCFSLayers.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const WMS_BASE = 'https://app-geoserver-wips-cwfis-prod.azurewebsites.net/geoserver/firestarr/wms';

describe('useCFSLayers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty when no API key configured', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Not found' }),
    });

    const { result } = renderHook(() => useCFSLayers());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.available).toBe(false);
    expect(result.current.layers).toHaveLength(0);
    expect(result.current.apiKey).toBeNull();
  });

  it('returns available layers when key exists', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ key: 'CFS_FIRESTARR_AUTHKEY', value: 'test-auth-key', source: 'db' }),
    });

    const { result } = renderHook(() => useCFSLayers());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.available).toBe(true);
    expect(result.current.apiKey).toBe('test-auth-key');
    expect(result.current.layers.length).toBeGreaterThan(0);

    // Should include CBMT and FireSTARR layers
    const layerNames = result.current.layers.map((l) => l.name);
    expect(layerNames).toContain('FireSTARR');
  });

  it('builds correct WMS URL with authkey and TIME params', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ key: 'CFS_FIRESTARR_AUTHKEY', value: 'my-auth-key', source: 'db' }),
    });

    const { result } = renderHook(() => useCFSLayers());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.available).toBe(true);

    const url = result.current.buildWmsUrl('firestarr:FireSTARR', '2026-03-01');

    // Must contain WMS base
    expect(url).toContain(WMS_BASE);
    // Must contain bbox placeholder
    expect(url).toContain('{bbox-epsg-3857}');
    // Must contain authkey
    expect(url).toContain('my-auth-key');
    // Must contain TIME param
    expect(url).toContain('2026-03-01');
    // Must contain layer name
    expect(url).toContain('FireSTARR');
    // Must be WMS GetMap request
    expect(url).toContain('GetMap');
  });
});
