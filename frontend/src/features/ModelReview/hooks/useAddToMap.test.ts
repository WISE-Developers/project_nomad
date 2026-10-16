/**
 * The bookkeeping must not claim a layer the map never took (#451, second half).
 *
 * `addGeoJSONLayer` opens with `if (!map || !isLoaded) return;` — correct, there
 * is nothing to add to yet, and silent. `addOutput` then recorded the layer id
 * in `outputLayersRef` REGARDLESS, so `isOnMap()` answered yes for a layer that
 * was never added.
 *
 * That is worse than a dropped click. A dropped click can be repeated; this
 * leaves a permanent wrong belief — the UI shows the output as already on the
 * map and will not offer to add it again, so the user cannot recover without a
 * reload.
 *
 * The same family as #448 and #451: an action that did nothing is
 * indistinguishable from one that worked. Here the component went further and
 * wrote the false belief down.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const addGeoJSONLayer = vi.fn();
const removeLayer = vi.fn();

vi.mock('../../Map/context/useLayers', () => ({
  useLayers: () => ({ addGeoJSONLayer, removeLayer }),
}));

const { useAddToMap } = await import('./useAddToMap.js');

const output = { id: 'out-1', name: 'Perimeter', type: 'perimeter' } as never;
const geoJson = { type: 'FeatureCollection', features: [] } as never;

describe('useAddToMap when the map cannot take a layer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records the layer and reports it on the map when the add succeeds', () => {
    // The control. Without this, the assertion below could pass by never
    // recording anything at all.
    addGeoJSONLayer.mockReturnValue(true);
    const { result } = renderHook(() => useAddToMap());

    let id: string | null = null;
    act(() => {
      id = result.current.addOutput(output, geoJson);
    });

    expect(id).toBe('output-out-1');
    expect(result.current.isOnMap('out-1')).toBe(true);
  });

  it('does NOT claim the layer is on the map when the add was refused', () => {
    addGeoJSONLayer.mockReturnValue(false);
    const { result } = renderHook(() => useAddToMap());

    let id: string | null = 'unset';
    act(() => {
      id = result.current.addOutput(output, geoJson);
    });

    expect(id).toBeNull();
    expect(result.current.isOnMap('out-1')).toBe(false);
  });

  it('lets the caller retry once the map is ready', () => {
    // The recovery this bug denied: the first attempt must leave no trace that
    // blocks the second.
    addGeoJSONLayer.mockReturnValue(false);
    const { result } = renderHook(() => useAddToMap());
    act(() => {
      result.current.addOutput(output, geoJson);
    });

    addGeoJSONLayer.mockReturnValue(true);
    act(() => {
      result.current.addOutput(output, geoJson);
    });

    expect(result.current.isOnMap('out-1')).toBe(true);
  });

  it('outputLayerIds is derived from a ref and does not refresh on its own', () => {
    // NOT the behaviour we want, recorded rather than asserted as correct.
    // `outputLayersRef` is a ref, so adding to it triggers no re-render and
    // `outputLayerIds` stays as it was at the last render. `isOnMap` reads the
    // ref live and is therefore the honest contract. No consumer uses either
    // today; whoever wires this up should fix the list or drop it rather than
    // discover this the way I did.
    addGeoJSONLayer.mockReturnValue(true);
    const { result } = renderHook(() => useAddToMap());
    act(() => {
      result.current.addOutput(output, geoJson);
    });
    expect(result.current.isOnMap('out-1')).toBe(true);
    expect(result.current.outputLayerIds).toEqual([]);
  });
});
