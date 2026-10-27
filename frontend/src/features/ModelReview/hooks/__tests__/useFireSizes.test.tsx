import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { OpenNomadProvider } from '../../../../openNomad/context/OpenNomadProvider.js';
import { useFireSizes } from '../useFireSizes';

const RESOLUTION = {
  hasEnsemble: true,
  series: { days: [], n: 2, nConstantAcrossDays: true, reducedPrecision: false },
  reason: null,
};

function harness(fetchImpl: ReturnType<typeof vi.fn>) {
  const adapter = { fetch: fetchImpl } as never;
  return ({ children }: { children: ReactNode }) => (
    <OpenNomadProvider adapter={adapter}>{children}</OpenNomadProvider>
  );
}

describe('useFireSizes', () => {
  it('calls the adapter with the FULL path including /api/v1', async () => {
    // The adapter's fetch is a raw passthrough: it does NOT prepend /api/v1,
    // unlike services/api.ts. Passing '/models/...' here silently 404s.
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => RESOLUTION });
    const { result } = renderHook(() => useFireSizes('m1'), { wrapper: harness(f) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(f).toHaveBeenCalledWith('/api/v1/models/m1/fire-sizes');
    expect(result.current.resolution).toEqual(RESOLUTION);
    expect(result.current.error).toBeNull();
  });

  it('does not fetch at all without a model id', async () => {
    const f = vi.fn();
    const { result } = renderHook(() => useFireSizes(undefined), { wrapper: harness(f) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(f).not.toHaveBeenCalled();
    expect(result.current.resolution).toBeNull();
  });

  it('surfaces a failed response as an error rather than an empty ensemble', async () => {
    // An empty ensemble and a broken request must not render the same: one is
    // "this run recorded none", the other is "we do not know".
    const f = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const { result } = renderHook(() => useFireSizes('m1'), { wrapper: harness(f) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toMatch(/500/);
    expect(result.current.resolution).toBeNull();
  });

  it('surfaces a thrown request as an error', async () => {
    const f = vi.fn().mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useFireSizes('m1'), { wrapper: harness(f) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toMatch(/offline/);
  });

  it('refetches when the model id changes', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => RESOLUTION });
    const { rerender, result } = renderHook(({ id }: { id: string }) => useFireSizes(id), {
      wrapper: harness(f),
      initialProps: { id: 'm1' },
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    rerender({ id: 'm2' });
    await waitFor(() => expect(f).toHaveBeenCalledWith('/api/v1/models/m2/fire-sizes'));
    expect(f).toHaveBeenCalledTimes(2);
  });
});
