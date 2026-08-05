/**
 * useFuelVintage — fetches how a model year resolves against installed fuel (#319).
 *
 * A failure to fetch must stay silent in the UI: the vintage notice is
 * advisory, and an API hiccup should never surface as an error banner on a
 * fire model the user is trying to run.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useFuelVintage } from '../useFuelVintage';
import * as api from '../../../services/api';

const RESOLVED = {
  requestedYear: 2023,
  vintage: 2023,
  matchedRequestedYear: true,
  usedFallback: false,
};

describe('useFuelVintage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves the vintage for the given model year', async () => {
    const spy = vi
      .spyOn(api, 'getFuelDatasets')
      .mockResolvedValue({ datasets: [], resolved: RESOLVED });

    const { result } = renderHook(() => useFuelVintage(2023));

    await waitFor(() => expect(result.current.resolved).toEqual(RESOLVED));
    expect(spy).toHaveBeenCalledWith(2023);
  });

  it('does not call the API when no model year is known', async () => {
    const spy = vi.spyOn(api, 'getFuelDatasets').mockResolvedValue({ datasets: [] });

    const { result } = renderHook(() => useFuelVintage(undefined));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(spy).not.toHaveBeenCalled();
    expect(result.current.resolved).toBeUndefined();
  });

  it('stays silent when the request fails — the notice is advisory', async () => {
    vi.spyOn(api, 'getFuelDatasets').mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useFuelVintage(2023));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.resolved).toBeUndefined();
  });

  it('refetches when the model year changes', async () => {
    const spy = vi
      .spyOn(api, 'getFuelDatasets')
      .mockResolvedValue({ datasets: [], resolved: RESOLVED });

    const { rerender } = renderHook(({ year }) => useFuelVintage(year), {
      initialProps: { year: 2023 as number | undefined },
    });

    await waitFor(() => expect(spy).toHaveBeenCalledWith(2023));
    rerender({ year: 2026 });
    await waitFor(() => expect(spy).toHaveBeenCalledWith(2026));
  });
});
