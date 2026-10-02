/**
 * useGeometrySync Hook
 *
 * Synchronizes DrawContext geometry with wizard form data.
 */

import { useEffect, useCallback } from 'react';
import { useDrawOptional } from '../../Map/context/DrawContext';
import { useWizardData } from '../../Wizard';
import type { ModelSetupData, SpatialData, BoundingBox } from '../types';
import type { DrawnFeature, DrawingMode } from '../../Map/types/geometry';

/**
 * Stable fallbacks for embedded mode (no DrawProvider) — issue #393.
 *
 * Written inline as `?? (() => {})` / `?? []` these were rebuilt on every
 * render, so every hook depending on them was rebuilt too and the
 * memoisation did nothing. Module constants are stable for the process,
 * which is all the deps arrays need.
 *
 * EMPTY_FEATURES is shared and must never be mutated. Nothing here does —
 * geometry updates always construct a new array.
 */
const NOOP = () => {};
const EMPTY_FEATURES: DrawnFeature[] = [];

/**
 * Calculate bounding box from features
 */
function calculateBounds(features: DrawnFeature[]): BoundingBox | undefined {
  if (!features.length) return undefined;

  const allCoords: [number, number][] = [];

  for (const feature of features) {
    const geom = feature.geometry;
    if (geom.type === 'Point') {
      allCoords.push(geom.coordinates as [number, number]);
    } else if (geom.type === 'LineString') {
      allCoords.push(...(geom.coordinates as [number, number][]));
    } else if (geom.type === 'Polygon') {
      for (const ring of geom.coordinates) {
        allCoords.push(...(ring as [number, number][]));
      }
    }
  }

  if (!allCoords.length) return undefined;

  const lngs = allCoords.map((c) => c[0]);
  const lats = allCoords.map((c) => c[1]);

  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

/**
 * Determine the dominant geometry type from features
 */
function getGeometryType(features: DrawnFeature[]): DrawingMode {
  if (!features.length) return 'none';

  // Count each type
  const counts = { point: 0, line: 0, polygon: 0 };
  for (const feature of features) {
    const type = feature.geometry.type;
    if (type === 'Point') counts.point++;
    else if (type === 'LineString') counts.line++;
    else if (type === 'Polygon') counts.polygon++;
  }

  // Return the most common type
  if (counts.polygon >= counts.line && counts.polygon >= counts.point) return 'polygon';
  if (counts.line >= counts.point) return 'line';
  return 'point';
}

export interface UseGeometrySyncOptions {
  /** Called when geometry changes */
  onGeometryChange?: (features: DrawnFeature[]) => void;
}

export interface UseGeometrySyncReturn {
  /** Current features from wizard data */
  features: DrawnFeature[];
  /** Update geometry in wizard data */
  updateGeometry: (features: DrawnFeature[]) => void;
  /** Clear all geometry */
  clearGeometry: () => void;
  /** Whether the draw context is ready */
  isReady: boolean;
}

/**
 * Hook to sync DrawContext with wizard form data
 *
 * Subscribes to draw events and updates wizard data automatically.
 * Also provides methods to programmatically update geometry.
 *
 * In embedded mode (no DrawProvider), returns safe fallbacks and
 * the adapter path in SpatialInputStep takes over.
 */
export function useGeometrySync(options: UseGeometrySyncOptions = {}): UseGeometrySyncReturn {
  const { onGeometryChange } = options;
  const { data, setField } = useWizardData<ModelSetupData>();
  const drawCtx = useDrawOptional();

  // Check if we're in embedded mode (no DrawProvider)
  const isEmbeddedMode = !drawCtx;

  // Extract draw context values (use no-ops for embedded mode)
  const isReady = drawCtx?.isReady ?? false;
  const deleteAll = drawCtx?.deleteAll ?? NOOP;
  const drawFeatures = drawCtx?.state.features ?? EMPTY_FEATURES;

  const features = data.geometry?.features ?? EMPTY_FEATURES;

  /**
   * Update geometry in wizard data
   */
  const updateGeometry = useCallback(
    (newFeatures: DrawnFeature[]) => {
      // In embedded mode, this is a no-op - geometry is managed by SpatialInputStep
      if (isEmbeddedMode) return;

      const geometryData: SpatialData = {
        type: getGeometryType(newFeatures),
        features: newFeatures,
        bounds: calculateBounds(newFeatures),
        inputMethod: data.geometry?.inputMethod ?? 'draw',
      };
      setField('geometry', geometryData);
      onGeometryChange?.(newFeatures);
    },
    [isEmbeddedMode, setField, data.geometry?.inputMethod, onGeometryChange]
  );

  /**
   * Clear all geometry
   */
  const clearGeometry = useCallback(() => {
    // In embedded mode, this is a no-op - geometry is managed by SpatialInputStep
    if (isEmbeddedMode) return;

    deleteAll();
    updateGeometry([]);
  }, [isEmbeddedMode, deleteAll, updateGeometry]);

  /**
   * Sync DrawContext features → wizard data.
   * Watches drawCtx.state.features directly via React effect
   * instead of subscriber callbacks, avoiding stale-snapshot issues.
   */
  useEffect(() => {
    if (isEmbeddedMode || !isReady) return;
    updateGeometry(drawFeatures);
  }, [isEmbeddedMode, isReady, drawFeatures, updateGeometry]);

  return {
    features,
    updateGeometry,
    clearGeometry,
    isReady,
  };
}
