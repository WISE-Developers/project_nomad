/**
 * Tests for DrawContext — deleteSelected must update state.features
 *
 * Bug: deleteSelected clears selectedIds but does NOT remove deleted features
 * from state.features, leaving ghost features in state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { DrawProvider, useDraw } from './DrawContext';
import type { DrawnFeature } from '../types/geometry';
import type { ReactNode } from 'react';

// Mock MapContext
vi.mock('./MapContext', () => ({
  useMap: () => ({
    map: mockMap,
    isLoaded: true,
  }),
}));

// Mock TerraDraw
const mockRemoveFeatures = vi.fn();
const mockClear = vi.fn();
const mockGetSnapshot = vi.fn(() => []);
const mockGetSnapshotFeature = vi.fn();
const mockSetMode = vi.fn();
const mockStart = vi.fn();
const mockStop = vi.fn();
const mockOn = vi.fn();
const mockAddFeatures = vi.fn(() => []);

vi.mock('terra-draw', () => ({
  // vitest 4 constructs mocked classes with `new`, and an arrow function
  // cannot be constructed. The implementation must be a `function` or a
  // `class` — vitest names this fix in the failure itself. Refs #384.
  TerraDraw: vi.fn().mockImplementation(function () {
    return {
      on: mockOn,
      start: mockStart,
      stop: mockStop,
      setMode: mockSetMode,
      getSnapshot: mockGetSnapshot,
      getSnapshotFeature: mockGetSnapshotFeature,
      removeFeatures: mockRemoveFeatures,
      clear: mockClear,
      addFeatures: mockAddFeatures,
    };
  }),
  TerraDrawPointMode: vi.fn(),
  TerraDrawLineStringMode: vi.fn(),
  TerraDrawPolygonMode: vi.fn(),
  TerraDrawSelectMode: vi.fn(),
}));

vi.mock('terra-draw-maplibre-gl-adapter', () => ({
  TerraDrawMapLibreGLAdapter: vi.fn(),
}));

// Mock map
const mockMap = {
  on: vi.fn(),
  off: vi.fn(),
  isStyleLoaded: vi.fn(() => true),
};

function makeFeature(id: string, type: 'Point' | 'LineString' | 'Polygon' = 'Point'): DrawnFeature {
  if (type === 'Point') {
    return {
      type: 'Feature',
      id,
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: {},
    };
  }
  if (type === 'LineString') {
    return {
      type: 'Feature',
      id,
      geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
      properties: {},
    };
  }
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    properties: {},
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return <DrawProvider>{children}</DrawProvider>;
}

describe('DrawContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('deleteSelected', () => {
    it('removes deleted features from state.features', () => {
      const { result } = renderHook(() => useDraw(), { wrapper });

      // Add 3 features
      const f1 = makeFeature('f1');
      const f2 = makeFeature('f2');
      const f3 = makeFeature('f3');

      act(() => {
        result.current.addFeatures([f1, f2, f3]);
      });

      expect(result.current.state.features).toHaveLength(3);

      // Simulate selecting f2
      act(() => {
        // Trigger the select event handler
        const selectHandler = mockOn.mock.calls.find(([event]: [string]) => event === 'select');
        if (selectHandler) {
          selectHandler[1]('f2');
        }
      });

      expect(result.current.state.selectedIds).toContain('f2');

      // Delete selected
      act(() => {
        result.current.deleteSelected();
      });

      // Features should have f2 removed
      expect(result.current.state.features).toHaveLength(2);
      expect(result.current.state.features.map(f => f.id)).toEqual(['f1', 'f3']);
      expect(result.current.state.selectedIds).toHaveLength(0);
    });

    it('notifies delete subscribers with removed features', () => {
      const { result } = renderHook(() => useDraw(), { wrapper });
      const deleteCb = vi.fn();

      act(() => {
        result.current.onDeleteSubscribe(deleteCb);
        result.current.addFeatures([makeFeature('f1'), makeFeature('f2')]);
      });

      // Select f1
      act(() => {
        const selectHandler = mockOn.mock.calls.find(([event]: [string]) => event === 'select');
        if (selectHandler) selectHandler[1]('f1');
      });

      act(() => {
        result.current.deleteSelected();
      });

      expect(deleteCb).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: 'f1' })])
      );
    });
  });

  describe('addFeatures resilience', () => {
    it('updates state even when TerraDraw addFeatures throws', () => {
      mockAddFeatures.mockImplementationOnce(() => {
        throw new Error("Cannot read properties of undefined (reading 'setData')");
      });

      const { result } = renderHook(() => useDraw(), { wrapper });

      act(() => {
        result.current.addFeatures([makeFeature('f1'), makeFeature('f2')]);
      });

      // State must still have the features despite TerraDraw crashing
      expect(result.current.state.features).toHaveLength(2);
    });

    it('updates state even when TerraDraw returns validation failures', () => {
      mockAddFeatures.mockImplementationOnce(() => [
        { valid: false, reason: 'Feature does not have a valid mode property' },
      ]);

      const { result } = renderHook(() => useDraw(), { wrapper });

      act(() => {
        result.current.addFeatures([makeFeature('f1')]);
      });

      // State must still have the feature
      expect(result.current.state.features).toHaveLength(1);
    });

    it('notifies subscribers even when TerraDraw throws', () => {
      mockAddFeatures.mockImplementationOnce(() => {
        throw new Error('adapter crash');
      });

      const { result } = renderHook(() => useDraw(), { wrapper });
      const createCb = vi.fn();

      act(() => {
        result.current.onCreateSubscribe(createCb);
        result.current.addFeatures([makeFeature('f1')]);
      });

      expect(createCb).toHaveBeenCalledTimes(1);
    });

    it('injects mode property from geometry type', () => {
      const { result } = renderHook(() => useDraw(), { wrapper });

      act(() => {
        result.current.addFeatures([
          makeFeature('p1', 'Point'),
          makeFeature('l1', 'LineString'),
          makeFeature('g1', 'Polygon'),
        ]);
      });

      const props = result.current.state.features.map(
        f => (f.properties as Record<string, unknown>)?.mode
      );
      expect(props).toEqual(['point', 'linestring', 'polygon']);
    });
  });

  describe('deleteAll', () => {
    it('removes all features from state', () => {
      const { result } = renderHook(() => useDraw(), { wrapper });

      act(() => {
        result.current.addFeatures([makeFeature('f1'), makeFeature('f2'), makeFeature('f3')]);
      });

      expect(result.current.state.features).toHaveLength(3);

      act(() => {
        result.current.deleteAll();
      });

      expect(result.current.state.features).toHaveLength(0);
      expect(result.current.state.selectedIds).toHaveLength(0);
      expect(mockClear).toHaveBeenCalled();
    });
  });
});
