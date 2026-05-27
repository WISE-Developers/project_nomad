/**
 * useSplash hook tests (#275)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSplash, SPLASH_LAST_ACKED_KEY } from './useSplash';

const enabledResp = (version = '1.0.0') => ({
  enabled: true,
  version,
  title: 'Welcome',
  body: '## body',
  dismissable: true,
});

function mockFetch(payload: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(payload),
  });
}

describe('useSplash', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('not visible when backend reports disabled', async () => {
    vi.stubGlobal('fetch', mockFetch({ enabled: false }));
    const { result } = renderHook(() => useSplash());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.visible).toBe(false);
    expect(result.current.content).toBeNull();
  });

  it('visible when enabled and version not yet acknowledged', async () => {
    vi.stubGlobal('fetch', mockFetch(enabledResp('1.0.0')));
    const { result } = renderHook(() => useSplash());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.visible).toBe(true);
    expect(result.current.content?.version).toBe('1.0.0');
  });

  it('not visible when enabled but version already acknowledged', async () => {
    localStorage.setItem(SPLASH_LAST_ACKED_KEY, '1.0.0');
    vi.stubGlobal('fetch', mockFetch(enabledResp('1.0.0')));
    const { result } = renderHook(() => useSplash());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.visible).toBe(false);
  });

  it('visible again when backend version differs from acknowledged', async () => {
    localStorage.setItem(SPLASH_LAST_ACKED_KEY, '1.0.0');
    vi.stubGlobal('fetch', mockFetch(enabledResp('2.0.0')));
    const { result } = renderHook(() => useSplash());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.visible).toBe(true);
  });

  it('dismiss writes version to localStorage and hides the splash', async () => {
    vi.stubGlobal('fetch', mockFetch(enabledResp('3.0.0')));
    const { result } = renderHook(() => useSplash());
    await waitFor(() => expect(result.current.visible).toBe(true));
    act(() => result.current.dismiss());
    expect(localStorage.getItem(SPLASH_LAST_ACKED_KEY)).toBe('3.0.0');
    expect(result.current.visible).toBe(false);
  });

  it('fails closed (not visible) when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const { result } = renderHook(() => useSplash());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.visible).toBe(false);
  });

  it('fails closed when backend returns 5xx', async () => {
    vi.stubGlobal('fetch', mockFetch({}, false, 500));
    const { result } = renderHook(() => useSplash());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.visible).toBe(false);
  });
});
