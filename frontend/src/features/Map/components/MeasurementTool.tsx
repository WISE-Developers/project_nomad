import React, { useCallback, useState, useEffect } from 'react';
import { useDraw } from '../context/DrawContext';
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
type MeasurementMode = 'distance' | 'area' | 'none';

/**
 * Measurement result
 */
interface MeasurementResult {
  type: MeasurementMode;
  value: number;
  formatted: string;
  perimeter?: string;
}

/**
 * Props for MeasurementTool component
 */
interface MeasurementToolProps {
  /** Position on the map */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** CSS class for additional styling */
  className?: string;
}

/**
 * Position style mapping
 */
const POSITION_STYLES: Record<string, React.CSSProperties> = {
  'top-left': { top: '200px', left: '10px' },
  'top-right': { top: '10px', right: '10px' },
  'bottom-left': { bottom: '80px', left: '10px' },
  'bottom-right': { bottom: '30px', right: '10px' },
};

/**
 * MeasurementTool provides UI for measuring distances and areas on the map.
 *
 * Uses the shared DrawContext so it works alongside DrawingToolbar.
 *
 * @example
 * ```tsx
 * <MapContainer>
 *   <MeasurementTool position="bottom-left" />
 * </MapContainer>
 * ```
 */
export function MeasurementTool({
  position = 'bottom-left',
  className = '',
}: MeasurementToolProps) {
  const { setMode, deleteAll, isReady, onCreateSubscribe } = useDraw();
  const [measureMode, setMeasureMode] = useState<MeasurementMode>('none');
  const [result, setResult] = useState<MeasurementResult | null>(null);

  // Handle feature creation for measurements
  const handleCreate = useCallback((features: DrawnFeature[]) => {
    if (features.length === 0 || measureMode === 'none') return;

    const feature = features[0];

    if (feature.geometry.type === 'LineString' && measureMode === 'distance') {
      const length = calculateLineLength(feature as LineFeature);
      setResult({
        type: 'distance',
        value: length,
        formatted: formatDistance(length),
      });
    } else if (feature.geometry.type === 'Polygon' && measureMode === 'area') {
      const area = calculatePolygonArea(feature as PolygonFeature);
      const perimeter = calculatePolygonPerimeter(feature as PolygonFeature);
      setResult({
        type: 'area',
        value: area,
        formatted: formatArea(area),
        perimeter: formatDistance(perimeter),
      });
    }
  }, [measureMode]);

  // Subscribe to create events
  useEffect(() => {
    return onCreateSubscribe(handleCreate);
  }, [onCreateSubscribe, handleCreate]);

  const measureDistance = useCallback(() => {
    setMeasureMode('distance');
    setResult(null);
    deleteAll();
    setMode('line');
  }, [setMode, deleteAll]);

  const measureArea = useCallback(() => {
    setMeasureMode('area');
    setResult(null);
    deleteAll();
    setMode('polygon');
  }, [setMode, deleteAll]);

  const clear = useCallback(() => {
    setMeasureMode('none');
    setResult(null);
    deleteAll();
    setMode('none');
  }, [setMode, deleteAll]);

  if (!isReady) {
    return null;
  }

  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    zIndex: 1,
    backgroundColor: 'white',
    borderRadius: '4px',
    boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
    padding: '8px',
    minWidth: '180px',
    ...POSITION_STYLES[position],
  };

  const buttonContainerStyle: React.CSSProperties = {
    display: 'flex',
    gap: '4px',
    marginBottom: result ? '8px' : 0,
  };

  const buttonStyle: React.CSSProperties = {
    flex: 1,
    padding: '8px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    fontSize: '12px',
    backgroundColor: 'white',
    transition: 'background-color 0.2s',
  };

  const activeButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    backgroundColor: '#e3f2fd',
    borderColor: '#2196f3',
  };

  const resultStyle: React.CSSProperties = {
    padding: '8px',
    backgroundColor: '#f5f5f5',
    borderRadius: '4px',
    fontSize: '14px',
  };

  const resultValueStyle: React.CSSProperties = {
    fontSize: '18px',
    fontWeight: 600,
    color: '#1976d2',
    marginBottom: '4px',
  };

  const resultLabelStyle: React.CSSProperties = {
    fontSize: '12px',
    color: '#666',
  };

  const clearButtonStyle: React.CSSProperties = {
    width: '100%',
    marginTop: '8px',
    padding: '6px',
    border: '1px solid #ffcdd2',
    borderRadius: '4px',
    backgroundColor: 'white',
    color: '#d32f2f',
    cursor: 'pointer',
    fontSize: '12px',
  };

  return (
    <div className={`measurement-tool ${className}`} style={containerStyle}>
      <div style={buttonContainerStyle}>
        <button
          style={measureMode === 'distance' ? activeButtonStyle : buttonStyle}
          onClick={measureDistance}
          title="Measure distance (double-click to finish)"
        >
          <i className="fa-solid fa-ruler" style={{ fontSize: '16px' }} />
          <span>Distance</span>
        </button>
        <button
          style={measureMode === 'area' ? activeButtonStyle : buttonStyle}
          onClick={measureArea}
          title="Measure area (double-click to finish)"
        >
          <i className="fa-solid fa-vector-square" style={{ fontSize: '16px' }} />
          <span>Area</span>
        </button>
      </div>

      {result && (
        <div style={resultStyle}>
          <div style={resultValueStyle}>{result.formatted}</div>
          <div style={resultLabelStyle}>
            {result.type === 'distance' ? 'Total distance' : 'Total area'}
          </div>
          {result.perimeter && (
            <div style={{ ...resultLabelStyle, marginTop: '4px' }}>
              Perimeter: {result.perimeter}
            </div>
          )}
        </div>
      )}

      {measureMode !== 'none' && (
        <button style={clearButtonStyle} onClick={clear}>
          Clear Measurement
        </button>
      )}

      {measureMode !== 'none' && !result && (
        <div style={{ ...resultLabelStyle, marginTop: '8px', textAlign: 'center' }}>
          {measureMode === 'distance'
            ? 'Click points, double-click to finish'
            : 'Click points, double-click to close'}
        </div>
      )}
    </div>
  );
}
