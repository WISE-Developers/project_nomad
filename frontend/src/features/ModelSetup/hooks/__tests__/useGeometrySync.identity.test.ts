/**
 * Referential stability of useGeometrySync's return — issue #393 group B.
 *
 * In embedded mode there is no DrawProvider, so `deleteAll` falls back to a
 * fresh `() => {}` and `drawFeatures` to a fresh `[]` on every render. Those
 * feed the deps of `clearGeometry` (useCallback) and the sync effect, so both
 * are rebuilt every render and the memoisation does nothing.
 *
 * `features` has the same shape: `data.geometry?.features ?? []`.
 *
 * The consumer-visible cost is churn, not a wrong value: a parent that passes
 * `clearGeometry` down re-renders every child on every render.
 *
 * The mocks below return MODULE-LEVEL CONSTANTS deliberately. If the harness
 * handed back a fresh object each render the test would be measuring itself.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ModelSetupData } from '../../types/index.js';

// Stable across every render — the hook is the only thing allowed to churn.
const WIZARD_DATA = { geometry: {}, model: {}, weather: {} } as unknown as ModelSetupData;
const SET_FIELD = vi.fn();

vi.mock('../../../Wizard', () => ({
  useWizardData: () => ({ data: WIZARD_DATA, setField: SET_FIELD }),
}));

// Embedded mode: no DrawProvider.
vi.mock('../../../Map/context/DrawContext', () => ({
  useDrawOptional: () => undefined,
}));

const { useGeometrySync } = await import('../useGeometrySync.js');

describe('useGeometrySync referential stability (embedded mode)', () => {
  it('keeps `features` identity across a re-render with unchanged inputs', () => {
    const { result, rerender } = renderHook(() => useGeometrySync());

    const first = result.current.features;
    rerender();
    const second = result.current.features;

    expect(second).toBe(first);
  });

  it('keeps `clearGeometry` identity across a re-render with unchanged inputs', () => {
    const { result, rerender } = renderHook(() => useGeometrySync());

    const first = result.current.clearGeometry;
    rerender();
    const second = result.current.clearGeometry;

    expect(second).toBe(first);
  });

  it('keeps `updateGeometry` identity across a re-render with unchanged inputs', () => {
    const { result, rerender } = renderHook(() => useGeometrySync());

    const first = result.current.updateGeometry;
    rerender();
    const second = result.current.updateGeometry;

    expect(second).toBe(first);
  });
});
