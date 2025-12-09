import React from 'react';
import { useDraw } from '../context/DrawContext';
import type { DrawingMode, DrawnFeature } from '../types/geometry';

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


const TOOLS: ToolButton[] = [
  { mode: 'point', label: 'Point', icon: 'location-dot', title: 'Draw a point (click on map)' },
  { mode: 'line', label: 'Line', icon: 'arrow-trend-up', title: 'Draw a line (double-click to finish)' },
  { mode: 'polygon', label: 'Polygon', icon: 'draw-polygon', title: 'Draw a polygon (double-click to finish)' },
];

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
 * DrawingToolbar provides UI controls for map drawing operations.
 *
 * Uses the shared DrawContext so it doesn't conflict with MeasurementTool.
 *
 * @example
 * ```tsx
 * <MapContainer>
 *   <DrawingToolbar
 *     position="top-left"
 *     onCreate={(features) => handleNewGeometry(features)}
 *   />
 * </MapContainer>
 * ```
 */
export function DrawingToolbar({
  onCreate,
  onDelete,
  position = 'top-left',
  className = '',
}: DrawingToolbarProps) {
  const { state, setMode, deleteSelected, deleteAll, isReady, onCreateSubscribe, onDeleteSubscribe } = useDraw();

  // Subscribe to events
  React.useEffect(() => {
    if (!onCreate) return;
    return onCreateSubscribe(onCreate);
  }, [onCreate, onCreateSubscribe]);

  React.useEffect(() => {
    if (!onDelete) return;
    return onDeleteSubscribe(onDelete);
  }, [onDelete, onDeleteSubscribe]);

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

  return (
    <div className={`drawing-toolbar ${className}`} style={containerStyle}>
      {TOOLS.map((tool) => (
        <button
          key={tool.mode}
          style={state.mode === tool.mode ? activeButtonStyle : buttonStyle}
          onClick={() => setMode(state.mode === tool.mode ? 'none' : tool.mode)}
          title={tool.title}
        >
          <i className={`fa-solid fa-${tool.icon}`} />
          <span>{tool.label}</span>
        </button>
      ))}
      <hr style={{ margin: '4px 0', border: 'none', borderTop: '1px solid #eee' }} />
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
