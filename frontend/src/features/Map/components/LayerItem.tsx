import { useRef, useCallback } from 'react';
import type { LayerConfig } from '../types/layer';

/**
 * Props for LayerItem component
 */
interface LayerItemProps {
  /** Layer configuration */
  layer: LayerConfig;
  /** Whether this layer is selected */
  isSelected: boolean;
  /** Whether this layer is being dragged */
  isDragging?: boolean;
  /** Whether another layer is being dragged over this one */
  isDragOver?: boolean;
  /** Toggle visibility callback */
  onToggleVisibility: () => void;
  /** Opacity change callback */
  onOpacityChange: (opacity: number) => void;
  /** Remove layer callback */
  onRemove: () => void;
  /** Select layer callback */
  onSelect: () => void;
  /** Drag start callback */
  onDragStart?: (e: React.DragEvent) => void;
  /** Drag over callback */
  onDragOver?: (e: React.DragEvent) => void;
  /** Drop callback */
  onDrop?: (e: React.DragEvent) => void;
  /** Drag end callback */
  onDragEnd?: () => void;
}

/**
 * LayerItem displays a single layer in the layer panel.
 *
 * Provides controls for:
 * - Visibility toggle
 * - Opacity slider
 * - Remove button
 */
export function LayerItem({
  layer,
  isSelected,
  isDragging = false,
  isDragOver = false,
  onToggleVisibility,
  onOpacityChange,
  onRemove,
  onSelect,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: LayerItemProps) {
  const dragHandleRef = useRef<HTMLDivElement>(null);

  // Only allow drag to start from the drag handle
  const handleDragStart = useCallback((e: React.DragEvent) => {
    // Check if drag originated from drag handle
    if (dragHandleRef.current && !dragHandleRef.current.contains(e.target as Node)) {
      e.preventDefault();
      return;
    }
    onDragStart?.(e);
  }, [onDragStart]);

  // Prevent slider interactions from triggering drag
  const handleSliderMouseDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
  }, []);

  const containerStyle: React.CSSProperties = {
    padding: '8px',
    marginBottom: '4px',
    borderRadius: '4px',
    border: isDragOver ? '2px dashed #2196f3' : isSelected ? '2px solid #2196f3' : '1px solid #eee',
    backgroundColor: isDragging ? '#f5f5f5' : isSelected ? '#e3f2fd' : 'white',
    opacity: isDragging ? 0.5 : 1,
    transition: 'border 0.15s, background-color 0.15s, opacity 0.15s',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '8px',
    marginBottom: '8px',
  };

  const nameStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '6px',
    flex: 1,
    minWidth: 0, // Allow text to shrink
  };

  const nameTextStyle: React.CSSProperties = {
    fontSize: '13px',
    fontWeight: 500,
    color: '#333',
    wordBreak: 'break-word',
    lineHeight: '1.3',
  };

  const buttonStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px',
    fontSize: '14px',
    opacity: 0.7,
  };

  const sliderContainerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    color: '#666',
  };

  const dragHandleStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'grab',
    padding: '4px 2px',
    marginRight: '4px',
    color: '#999',
    flexShrink: 0,
  };

  const typeIcon = layer.type === 'geojson'
    ? <i className="fa-solid fa-bezier-curve" title="Vector layer" style={{ color: '#42a5f5' }} />
    : <i className="fa-solid fa-table-cells" title="Raster layer" style={{ color: '#42a5f5' }} />;

  // Breaks mode indicator for probability layers
  const breaksModeIndicator = layer.breaksMode ? (
    <span
      style={{
        fontSize: '10px',
        padding: '1px 4px',
        borderRadius: '3px',
        backgroundColor: layer.breaksMode === 'static' ? '#e3f2fd' : '#fff3e0',
        color: layer.breaksMode === 'static' ? '#1565c0' : '#e65100',
        fontWeight: 500,
        flexShrink: 0,
      }}
      title={
        layer.breaksMode === 'static'
          ? 'Static breaks: Fixed 10% intervals for consistent comparison'
          : 'Dynamic breaks: Quantile breaks from this output'
      }
    >
      {layer.breaksMode === 'static' ? <i className="fa-solid fa-ruler" /> : <i className="fa-solid fa-chart-bar" />}
    </span>
  ) : null;

  return (
    <div
      style={containerStyle}
      onClick={onSelect}
      draggable
      onDragStart={handleDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <div style={headerStyle}>
        {/* Drag handle - only this area initiates drag */}
        <div
          ref={dragHandleRef}
          style={dragHandleStyle}
          title="Drag to reorder"
          data-testid="layer-drag-handle"
        >
          <i className="fa-solid fa-grip-vertical" />
        </div>
        <div style={nameStyle}>
          <button
            style={{ ...buttonStyle, flexShrink: 0 }}
            onClick={(e) => {
              e.stopPropagation();
              onToggleVisibility();
            }}
            title={layer.visible ? 'Hide layer' : 'Show layer'}
          >
            <i className={`fa-solid ${layer.visible ? 'fa-eye' : 'fa-eye-slash'}`} />
          </button>
          <span style={{ flexShrink: 0 }}>{typeIcon}</span>
          {breaksModeIndicator}
          <span style={nameTextStyle}>{layer.name}</span>
        </div>
        <button
          style={{ ...buttonStyle, color: '#d32f2f', flexShrink: 0 }}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title="Remove layer"
        >
          ✕
        </button>
      </div>
      <div style={sliderContainerStyle}>
        <span>Opacity:</span>
        <input
          type="range"
          min="0"
          max="100"
          value={layer.opacity * 100}
          onChange={(e) => onOpacityChange(Number(e.target.value) / 100)}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={handleSliderMouseDown}
          onTouchStart={handleSliderMouseDown}
          data-testid="layer-opacity-slider"
          className="layer-opacity-slider"
        />
        <span>{Math.round(layer.opacity * 100)}%</span>
      </div>
      {/* Slider custom styling */}
      <style>{`
        .layer-opacity-slider {
          flex: 1;
          height: 20px;
          cursor: pointer;
          -webkit-appearance: none;
          appearance: none;
          background: transparent;
        }
        .layer-opacity-slider::-webkit-slider-runnable-track {
          width: 100%;
          height: 8px;
          background: linear-gradient(to right, #e0e0e0, #2196f3);
          border-radius: 4px;
          cursor: pointer;
        }
        .layer-opacity-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          background: #2196f3;
          border: 2px solid white;
          border-radius: 50%;
          cursor: pointer;
          margin-top: -5px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }
        .layer-opacity-slider::-webkit-slider-thumb:hover {
          background: #1976d2;
          transform: scale(1.1);
        }
        .layer-opacity-slider::-moz-range-track {
          width: 100%;
          height: 8px;
          background: linear-gradient(to right, #e0e0e0, #2196f3);
          border-radius: 4px;
          cursor: pointer;
        }
        .layer-opacity-slider::-moz-range-thumb {
          width: 18px;
          height: 18px;
          background: #2196f3;
          border: 2px solid white;
          border-radius: 50%;
          cursor: pointer;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }
        .layer-opacity-slider::-moz-range-thumb:hover {
          background: #1976d2;
          transform: scale(1.1);
        }
        .layer-opacity-slider:focus {
          outline: none;
        }
        .layer-opacity-slider:focus::-webkit-slider-thumb {
          box-shadow: 0 0 0 3px rgba(33, 150, 243, 0.3);
        }
        .layer-opacity-slider:focus::-moz-range-thumb {
          box-shadow: 0 0 0 3px rgba(33, 150, 243, 0.3);
        }
      `}</style>
    </div>
  );
}
