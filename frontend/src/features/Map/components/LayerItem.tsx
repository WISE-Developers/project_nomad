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
  const containerStyle: React.CSSProperties = {
    padding: '8px',
    marginBottom: '4px',
    borderRadius: '4px',
    border: isDragOver ? '2px dashed #2196f3' : isSelected ? '2px solid #2196f3' : '1px solid #eee',
    backgroundColor: isDragging ? '#f5f5f5' : isSelected ? '#e3f2fd' : 'white',
    cursor: 'grab',
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

  const sliderStyle: React.CSSProperties = {
    flex: 1,
    height: '4px',
    cursor: 'pointer',
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
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <div style={headerStyle}>
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
          style={sliderStyle}
        />
        <span>{Math.round(layer.opacity * 100)}%</span>
      </div>
    </div>
  );
}
