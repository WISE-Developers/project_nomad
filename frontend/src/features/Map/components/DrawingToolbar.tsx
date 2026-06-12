import React, { useCallback, useState, useEffect } from 'react';
import { useDraw, useDrawOptional } from '../context/DrawContext';
import type { DrawingMode, DrawnFeature, LineFeature, PolygonFeature } from '../types/geometry';
import {
  calculateLineLength,
  calculatePolygonArea,
  calculatePolygonPerimeter,
  formatDistance,
  formatArea,
} from '../../../shared/utils/geometry';

/**
 * Props for DrawingToolbar component
 */
interface DrawingToolbarProps {
  /** Callback when features are created */
  onCreate?: (features: DrawnFeature[]) => void;
  /** Callback when features are deleted */
  onDelete?: (features: DrawnFeature[]) => void;
  /** Position on the map */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** CSS class for additional styling */
  className?: string;
}

/**
 * Tool button configuration
 */
interface ToolButton {
  mode: DrawingMode;
  label: string;
  icon: string;
  title: string;
}

const DRAW_TOOLS: ToolButton[] = [
  { mode: 'point', label: 'Point', icon: 'location-dot', title: 'Draw a point (click on map)' },
  { mode: 'line', label: 'Line', icon: 'arrow-trend-up', title: 'Draw a line (double-click to finish)' },
  { mode: 'polygon', label: 'Polygon', icon: 'draw-polygon', title: 'Draw a polygon (double-click to finish)' },
];

type MeasurementMode = 'distance' | 'area' | 'none';

interface MeasurementResult {
  type: MeasurementMode;
  value: number;
  formatted: string;
  perimeter?: string;
}

/**
 * Position style mapping
 */
const POSITION_STYLES: Record<string, React.CSSProperties> = {
  'top-left': { top: '10px', left: '10px' },
  'top-right': { top: '10px', right: '60px' },
  'bottom-left': { bottom: '80px', left: '10px' },
  'bottom-right': { bottom: '30px', right: '10px' },
};

/**
 * DrawingToolbar provides UI controls for map drawing and measurement.
 *
 * Consolidates draw tools (Point, Line, Polygon) and measurement tools
 * (Distance, Area) into a single toolbar. Uses the shared DrawContext.
 */
export function DrawingToolbar(props: DrawingToolbarProps) {
  // The toolbar is meaningless without a DrawContext (e.g. when the wizard is
  // mounted in an embedded/ACN host that doesn't provide a Nomad-owned map).
  // Render nothing in that case.
  const ctx = useDrawOptional();
  if (!ctx) return null;
  return <DrawingToolbarInner {...props} />;
}

function DrawingToolbarInner({
  onCreate,
  onDelete,
  position = 'top-left',
  className = '',
}: DrawingToolbarProps) {
  const { state, setMode, deleteSelected, deleteAll, isReady, onCreateSubscribe, onDeleteSubscribe } = useDraw();
  const [measureMode, setMeasureMode] = useState<MeasurementMode>('none');
  const [measureResult, setMeasureResult] = useState<MeasurementResult | null>(null);

  // Subscribe to create/delete events for drawing callbacks
  useEffect(() => {
    if (!onCreate) return;
    return onCreateSubscribe(onCreate);
  }, [onCreate, onCreateSubscribe]);

  useEffect(() => {
    if (!onDelete) return;
    return onDeleteSubscribe(onDelete);
  }, [onDelete, onDeleteSubscribe]);

  // Handle feature creation for measurements
  const handleMeasureCreate = useCallback((features: DrawnFeature[]) => {
    if (features.length === 0 || measureMode === 'none') return;
    const feature = features[0];

    if (feature.geometry.type === 'LineString' && measureMode === 'distance') {
      const length = calculateLineLength(feature as LineFeature);
      setMeasureResult({ type: 'distance', value: length, formatted: formatDistance(length) });
    } else if (feature.geometry.type === 'Polygon' && measureMode === 'area') {
      const area = calculatePolygonArea(feature as PolygonFeature);
      const perimeter = calculatePolygonPerimeter(feature as PolygonFeature);
      setMeasureResult({ type: 'area', value: area, formatted: formatArea(area), perimeter: formatDistance(perimeter) });
    }
  }, [measureMode]);

  useEffect(() => {
    return onCreateSubscribe(handleMeasureCreate);
  }, [onCreateSubscribe, handleMeasureCreate]);

  const measureDistance = useCallback(() => {
    setMeasureMode('distance');
    setMeasureResult(null);
    deleteAll();
    setMode('line');
  }, [setMode, deleteAll]);

  const measureArea = useCallback(() => {
    setMeasureMode('area');
    setMeasureResult(null);
    deleteAll();
    setMode('polygon');
  }, [setMode, deleteAll]);

  const clearMeasurement = useCallback(() => {
    setMeasureMode('none');
    setMeasureResult(null);
    deleteAll();
    setMode('none');
  }, [setMode, deleteAll]);

  // When switching to a draw tool, exit measurement mode
  const handleDrawToolClick = useCallback((toolMode: DrawingMode) => {
    if (measureMode !== 'none') {
      setMeasureMode('none');
      setMeasureResult(null);
    }
    setMode(state.mode === toolMode ? 'none' : toolMode);
  }, [state.mode, setMode, measureMode]);

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
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    ...POSITION_STYLES[position],
  };

  const buttonStyle: React.CSSProperties = {
    padding: '8px 12px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    backgroundColor: 'white',
    transition: 'background-color 0.2s',
  };

  const activeButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    backgroundColor: '#e3f2fd',
    borderColor: '#2196f3',
  };

  const deleteButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    color: '#d32f2f',
    borderColor: '#ffcdd2',
  };

  const divider = <hr style={{ margin: '4px 0', border: 'none', borderTop: '1px solid #eee' }} />;

  return (
    <div className={`drawing-toolbar ${className}`} style={containerStyle}>
      {/* Draw tools */}
      {DRAW_TOOLS.map((tool) => (
        <button
          key={tool.mode}
          style={state.mode === tool.mode && measureMode === 'none' ? activeButtonStyle : buttonStyle}
          onClick={() => handleDrawToolClick(tool.mode)}
          title={tool.title}
        >
          <i className={`fa-solid fa-${tool.icon}`} />
          <span>{tool.label}</span>
        </button>
      ))}

      {divider}

      {/* Measurement tools */}
      <button
        style={measureMode === 'distance' ? activeButtonStyle : buttonStyle}
        onClick={measureDistance}
        title="Measure distance (double-click to finish)"
      >
        <i className="fa-solid fa-ruler" />
        <span>Distance</span>
      </button>
      <button
        style={measureMode === 'area' ? activeButtonStyle : buttonStyle}
        onClick={measureArea}
        title="Measure area (double-click to finish)"
      >
        <i className="fa-solid fa-vector-square" />
        <span>Area</span>
      </button>

      {/* Measurement result */}
      {measureResult && (
        <div style={{ padding: '8px', backgroundColor: '#f5f5f5', borderRadius: '4px', fontSize: '14px' }}>
          <div style={{ fontSize: '16px', fontWeight: 600, color: '#1976d2', marginBottom: '2px' }}>
            {measureResult.formatted}
          </div>
          <div style={{ fontSize: '12px', color: '#666' }}>
            {measureResult.type === 'distance' ? 'Total distance' : 'Total area'}
          </div>
          {measureResult.perimeter && (
            <div style={{ fontSize: '12px', color: '#666', marginTop: '2px' }}>
              Perimeter: {measureResult.perimeter}
            </div>
          )}
        </div>
      )}

      {measureMode !== 'none' && !measureResult && (
        <div style={{ fontSize: '12px', color: '#666', textAlign: 'center', padding: '4px' }}>
          {measureMode === 'distance' ? 'Click points, double-click to finish' : 'Click points, double-click to close'}
        </div>
      )}

      {measureMode !== 'none' && (
        <button style={{ ...deleteButtonStyle, fontSize: '12px', padding: '6px 12px' }} onClick={clearMeasurement}>
          Clear Measurement
        </button>
      )}

      {divider}

      {/* Delete tools */}
      <button
        style={deleteButtonStyle}
        onClick={deleteSelected}
        disabled={state.selectedIds.length === 0}
        title="Delete selected features"
      >
        <i className="fa-solid fa-trash" />
        <span>Delete</span>
      </button>
      <button
        style={deleteButtonStyle}
        onClick={deleteAll}
        disabled={state.features.length === 0}
        title="Clear all features"
      >
        <i className="fa-solid fa-delete-left" />
        <span>Clear All</span>
      </button>
    </div>
  );
}
