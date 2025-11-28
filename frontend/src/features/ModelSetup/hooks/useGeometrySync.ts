/**
 * useGeometrySync Hook
 *
 * Synchronizes DrawContext geometry with wizard form data.
 */

import { useEffect, useCallback } from 'react';
import { useDraw } from '../../Map/context/DrawContext';
import { useWizardData } from '../../Wizard';
import type { ModelSetupData, SpatialData, BoundingBox } from '../types';
import type { DrawnFeature, DrawingMode } from '../../Map/types/geometry';

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
 */
export function useGeometrySync(options: UseGeometrySyncOptions = {}): UseGeometrySyncReturn {
  const { onGeometryChange } = options;
  const { data, setField } = useWizardData<ModelSetupData>();
  const { getFeatures, isReady, onCreateSubscribe, onUpdateSubscribe, onDeleteSubscribe, deleteAll } = useDraw();

  const features = data.geometry?.features ?? [];

  /**
   * Update geometry in wizard data
   */
  const updateGeometry = useCallback(
    (newFeatures: DrawnFeature[]) => {
      const geometryData: SpatialData = {
        type: getGeometryType(newFeatures),
        features: newFeatures,
        bounds: calculateBounds(newFeatures),
        inputMethod: data.geometry?.inputMethod ?? 'draw',
      };
      setField('geometry', geometryData);
      onGeometryChange?.(newFeatures);
    },
    [setField, data.geometry?.inputMethod, onGeometryChange]
  );

  /**
   * Clear all geometry
   */
  const clearGeometry = useCallback(() => {
    deleteAll();
    updateGeometry([]);
  }, [deleteAll, updateGeometry]);

  /**
   * Subscribe to draw events and sync with wizard
   */
  useEffect(() => {
    if (!isReady) return;

    const syncFromDraw = () => {
      const currentFeatures = getFeatures();
      updateGeometry(currentFeatures);
    };

    const unsubCreate = onCreateSubscribe(syncFromDraw);
    const unsubUpdate = onUpdateSubscribe(syncFromDraw);
    const unsubDelete = onDeleteSubscribe(syncFromDraw);

    return () => {
      unsubCreate();
      unsubUpdate();
      unsubDelete();
    };
  }, [isReady, getFeatures, updateGeometry, onCreateSubscribe, onUpdateSubscribe, onDeleteSubscribe]);

  return {
    features,
    updateGeometry,
    clearGeometry,
    isReady,
  };
}
