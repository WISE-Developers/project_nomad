import { useLayers } from '../hooks/useLayers';
import { LayerItem } from './LayerItem';

/**
 * Props for LayerPanel component
 */
interface LayerPanelProps {
  /** Position on the map */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** Whether the panel is expanded */
  expanded?: boolean;
  /** CSS class for additional styling */
  className?: string;
}

/**
 * Position style mapping
 */
const POSITION_STYLES: Record<string, React.CSSProperties> = {
  'top-left': { top: '10px', left: '10px' },
  'top-right': { top: '10px', right: '10px' },
  'bottom-left': { bottom: '30px', left: '10px' },
  'bottom-right': { bottom: '30px', right: '10px' },
};

/**
 * LayerPanel displays and manages map layers.
 *
 * Provides a UI for:
 * - Viewing all layers
 * - Toggling layer visibility
 * - Adjusting layer opacity
 * - Removing layers
 *
 * @example
 * ```tsx
 * <MapContainer>
 *   <LayerPanel position="top-right" />
 * </MapContainer>
 * ```
 */
export function LayerPanel({
  position = 'top-right',
  expanded: _initialExpanded = true,
  className = '',
}: LayerPanelProps) {
  // Note: _initialExpanded reserved for future collapsible panel feature
  const { state, setOpacity, toggleVisibility, removeLayer, selectLayer } = useLayers();

  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    zIndex: 1,
    backgroundColor: 'white',
    borderRadius: '4px',
    boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
    minWidth: '250px',
    maxHeight: '400px',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    ...POSITION_STYLES[position],
  };

  const headerStyle: React.CSSProperties = {
    padding: '12px 16px',
    borderBottom: '1px solid #eee',
    fontWeight: 600,
    fontSize: '14px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  };

  const listStyle: React.CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    padding: '8px',
  };

  const emptyStyle: React.CSSProperties = {
    padding: '24px 16px',
    textAlign: 'center',
    color: '#666',
    fontSize: '14px',
  };

  if (state.layers.length === 0) {
    return (
      <div className={`layer-panel ${className}`} style={containerStyle}>
        <div style={headerStyle}>
          <span>Layers</span>
          <span style={{ fontSize: '12px', color: '#999' }}>0</span>
        </div>
        <div style={emptyStyle}>
          No layers added yet
        </div>
      </div>
    );
  }

  return (
    <div className={`layer-panel ${className}`} style={containerStyle}>
      <div style={headerStyle}>
        <span>Layers</span>
        <span style={{ fontSize: '12px', color: '#999' }}>{state.layers.length}</span>
      </div>
      <div style={listStyle}>
        {state.layers.map((layer) => (
          <LayerItem
            key={layer.id}
            layer={layer}
            isSelected={state.selectedLayerId === layer.id}
            onToggleVisibility={() => toggleVisibility(layer.id)}
            onOpacityChange={(opacity) => setOpacity(layer.id, opacity)}
            onRemove={() => removeLayer(layer.id)}
            onSelect={() => selectLayer(layer.id)}
          />
        ))}
      </div>
    </div>
  );
}
