import type { LayerConfig } from '../types/layer';

/**
 * Props for LayerItem component
 */
interface LayerItemProps {
  /** Layer configuration */
  layer: LayerConfig;
  /** Whether this layer is selected */
  isSelected: boolean;
  /** Toggle visibility callback */
  onToggleVisibility: () => void;
  /** Opacity change callback */
  onOpacityChange: (opacity: number) => void;
  /** Remove layer callback */
  onRemove: () => void;
  /** Select layer callback */
  onSelect: () => void;
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
  onToggleVisibility,
  onOpacityChange,
  onRemove,
  onSelect,
}: LayerItemProps) {
  const containerStyle: React.CSSProperties = {
    padding: '8px',
    marginBottom: '4px',
    borderRadius: '4px',
    border: isSelected ? '2px solid #2196f3' : '1px solid #eee',
    backgroundColor: isSelected ? '#e3f2fd' : 'white',
    cursor: 'pointer',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '8px',
  };

  const nameStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    fontWeight: 500,
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

  const typeIcon = layer.type === 'geojson' ? '🗺️' : '🖼️';

  return (
    <div style={containerStyle} onClick={onSelect}>
      <div style={headerStyle}>
        <div style={nameStyle}>
          <button
            style={buttonStyle}
            onClick={(e) => {
              e.stopPropagation();
              onToggleVisibility();
            }}
            title={layer.visible ? 'Hide layer' : 'Show layer'}
          >
            {layer.visible ? '👁️' : '👁️‍🗨️'}
          </button>
          <span>{typeIcon}</span>
          <span>{layer.name}</span>
        </div>
        <button
          style={{ ...buttonStyle, color: '#d32f2f' }}
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
