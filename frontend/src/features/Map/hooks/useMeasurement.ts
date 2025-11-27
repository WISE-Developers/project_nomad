import { useCallback, useState } from 'react';
import { useDrawing } from './useDrawing';
import {
  calculateLineLength,
  calculatePolygonArea,
  calculatePolygonPerimeter,
  formatDistance,
  formatArea,
} from '../../../shared/utils/geometry';
import type { DrawnFeature, LineFeature, PolygonFeature } from '../types/geometry';

/**
 * Measurement mode
 */
export type MeasurementMode = 'distance' | 'area' | 'none';

/**
 * Measurement result
 */
export interface MeasurementResult {
  /** Measurement type */
  type: MeasurementMode;
  /** Raw value (km for distance, km² for area) */
  value: number;
  /** Formatted display string */
  formatted: string;
  /** Additional info (perimeter for area measurements) */
  perimeter?: string;
  /** The feature being measured */
  feature: DrawnFeature | null;
}

/**
 * Hook return value
 */
interface UseMeasurementReturn {
  /** Current measurement mode */
  mode: MeasurementMode;
  /** Current measurement result */
  result: MeasurementResult | null;
  /** Start distance measurement */
  measureDistance: () => void;
  /** Start area measurement */
  measureArea: () => void;
  /** Clear current measurement */
  clear: () => void;
  /** Whether measurement is active */
  isActive: boolean;
}

/**
 * Hook for map measurement operations.
 *
 * Provides distance and area measurement using the drawing tools.
 * Uses Turf.js for accurate geodesic calculations.
 *
 * @example
 * ```tsx
 * function MeasureExample() {
 *   const { mode, result, measureDistance, measureArea, clear } = useMeasurement();
 *
 *   return (
 *     <div>
 *       <button onClick={measureDistance}>Measure Distance</button>
 *       <button onClick={measureArea}>Measure Area</button>
 *       {result && <div>{result.formatted}</div>}
 *       <button onClick={clear}>Clear</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useMeasurement(): UseMeasurementReturn {
  const [mode, setMode] = useState<MeasurementMode>('none');
  const [result, setResult] = useState<MeasurementResult | null>(null);

  const handleCreate = useCallback((features: DrawnFeature[]) => {
    if (features.length === 0) return;

    const feature = features[0];

    if (feature.geometry.type === 'LineString') {
      const length = calculateLineLength(feature as LineFeature);
      setResult({
        type: 'distance',
        value: length,
        formatted: formatDistance(length),
        feature,
      });
    } else if (feature.geometry.type === 'Polygon') {
      const area = calculatePolygonArea(feature as PolygonFeature);
      const perimeter = calculatePolygonPerimeter(feature as PolygonFeature);
      setResult({
        type: 'area',
        value: area,
        formatted: formatArea(area),
        perimeter: formatDistance(perimeter),
        feature,
      });
    }
  }, []);

  const { setMode: setDrawMode, deleteAll } = useDrawing({
    onCreate: handleCreate,
  });

  const measureDistance = useCallback(() => {
    setMode('distance');
    setResult(null);
    deleteAll();
    setDrawMode('line');
  }, [setDrawMode, deleteAll]);

  const measureArea = useCallback(() => {
    setMode('area');
    setResult(null);
    deleteAll();
    setDrawMode('polygon');
  }, [setDrawMode, deleteAll]);

  const clear = useCallback(() => {
    setMode('none');
    setResult(null);
    deleteAll();
    setDrawMode('none');
  }, [setDrawMode, deleteAll]);

  return {
    mode,
    result,
    measureDistance,
    measureArea,
    clear,
    isActive: mode !== 'none',
  };
}
