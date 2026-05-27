/**
 * Tests for useSplash (#275).
 *
 * Splash shows on every page load when enabled. Dismiss closes the modal
 * for the current load only — no persistence.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSplash, SPLASH_ENDPOINT } from './useSplash';

function mockFetchResponse(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  } as unknown as Response);
}

describe('useSplash', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('not visible when backend returns enabled=false', async () => {
    globalThis.fetch = mockFetchResponse({ enabled: false });
    const { result } = renderHook(() => useSplash());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.visible).toBe(false);
    expect(result.current.content).toBeNull();
  });

  it('visible when backend returns enabled=true with content', async () => {
    globalThis.fetch = mockFetchResponse({
      enabled: true,
      title: 'Hello',
      body: '## hi',
      dismissable: true,
    });
    const { result } = renderHook(() => useSplash());
    await waitFor(() => expect(result.current.visible).toBe(true));
    expect(result.current.content).toEqual({
      title: 'Hello',
      body: '## hi',
      dismissable: true,
    });
  });

  it('dismiss() closes the modal for the current load', async () => {
    globalThis.fetch = mockFetchResponse({
      enabled: true,
      title: 'Hello',
      body: '## hi',
    });
    const { result } = renderHook(() => useSplash());
    await waitFor(() => expect(result.current.visible).toBe(true));
    act(() => result.current.dismiss());
    expect(result.current.visible).toBe(false);
  });

  it('always visible on a fresh mount when enabled (no persistence between sessions)', async () => {
    // Simulate a "page reload" by re-mounting the hook with the same content.
    // Even if the user dismissed it in a previous session, a new mount should
    // show it again because we deliberately store no state.
    globalThis.fetch = mockFetchResponse({
      enabled: true,
      title: 'Hello',
      body: '## hi',
    });
    const first = renderHook(() => useSplash());
    await waitFor(() => expect(first.result.current.visible).toBe(true));
    act(() => first.result.current.dismiss());
    expect(first.result.current.visible).toBe(false);
    first.unmount();

    // Fresh mount — same response → should be visible again.
    const second = renderHook(() => useSplash());
    await waitFor(() => expect(second.result.current.visible).toBe(true));
  });

  it('fail-closed when fetch throws', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useSplash());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.visible).toBe(false);
  });

  it('fail-closed on 5xx', async () => {
    globalThis.fetch = mockFetchResponse({}, false, 500);
    const { result } = renderHook(() => useSplash());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.visible).toBe(false);
  });

  it('not visible when payload is missing required fields', async () => {
    globalThis.fetch = mockFetchResponse({ enabled: true, version: '1.0.0' });
    const { result } = renderHook(() => useSplash());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.visible).toBe(false);
  });

  it('hits the right endpoint', async () => {
    const fetchSpy = mockFetchResponse({ enabled: false });
    globalThis.fetch = fetchSpy;
    renderHook(() => useSplash());
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(SPLASH_ENDPOINT));
  });
});
