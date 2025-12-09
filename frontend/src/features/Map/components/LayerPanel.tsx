import { useState } from 'react';
import { useLayers } from '../context/LayerContext';
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
  'top-right': { top: '100px', right: '10px' },
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
  const { state, setOpacity, toggleVisibility, removeLayer, selectLayer, reorderLayer } = useLayers();

  // Drag and drop state
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, layerId: string) => {
    setDraggedId(layerId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', layerId);
  };

  const handleDragOver = (e: React.DragEvent, layerId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedId && layerId !== draggedId) {
      setDragOverId(layerId);
    }
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (draggedId && draggedId !== targetId) {
      const targetIndex = state.layers.findIndex(l => l.id === targetId);
      if (targetIndex >= 0) {
        reorderLayer(draggedId, targetIndex);
      }
    }
    setDraggedId(null);
    setDragOverId(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    zIndex: 1,
    backgroundColor: 'white',
    borderRadius: '4px',
    boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
    minWidth: '280px',
    maxWidth: '350px',
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
    color: '#333',
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
          <span><i className="fa-solid fa-layer-group" style={{ marginRight: '8px' }} />Layers</span>
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
        <span><i className="fa-solid fa-layer-group" style={{ marginRight: '8px' }} />Layers</span>
        <span style={{ fontSize: '12px', color: '#999' }}>{state.layers.length}</span>
      </div>
      <div style={listStyle}>
        {state.layers.map((layer) => (
          <LayerItem
            key={layer.id}
            layer={layer}
            isSelected={state.selectedLayerId === layer.id}
            isDragging={draggedId === layer.id}
            isDragOver={dragOverId === layer.id}
            onToggleVisibility={() => toggleVisibility(layer.id)}
            onOpacityChange={(opacity) => setOpacity(layer.id, opacity)}
            onRemove={() => removeLayer(layer.id)}
            onSelect={() => selectLayer(layer.id)}
            onDragStart={(e) => handleDragStart(e, layer.id)}
            onDragOver={(e) => handleDragOver(e, layer.id)}
            onDrop={(e) => handleDrop(e, layer.id)}
            onDragEnd={handleDragEnd}
          />
        ))}
      </div>
    </div>
  );
}
