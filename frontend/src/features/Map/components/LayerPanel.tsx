import { useState, useCallback, useEffect } from 'react';
import { useLayers } from '../context/LayerContext';
import { useMap } from '../context/MapContext';
import { LayerItem } from './LayerItem';
import { useCFSLayers } from '../hooks/useCFSLayers';
import { useCwfisM3Layers, currentSeasonTime } from '../hooks/useCwfisM3Layers';
import { useTerrain } from '../hooks/useTerrain';
import { BasemapStyle, BASEMAP_STYLES } from '../types';

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
  const { state, setOpacity, toggleVisibility, removeLayer, selectLayer, reorderLayer, addRasterLayer, updateLayer } = useLayers();
  const cfs = useCFSLayers();
  const cwfis = useCwfisM3Layers();

  // Responsive — collapse on mobile
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024);
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const isMobile = windowWidth < 480;
  const [collapsed, setCollapsed] = useState(isMobile);

  // Basemap state
  const { map } = useMap();
  const BASEMAP_STORAGE_KEY = 'nomad-basemap-style';
  const [activeBasemap, setActiveBasemap] = useState<BasemapStyle>(() => {
    const stored = localStorage.getItem(BASEMAP_STORAGE_KEY);
    return (stored as BasemapStyle) || 'outdoors';
  });

  const handleBasemapChange = useCallback((style: BasemapStyle) => {
    if (!map || style === activeBasemap) return;
    map.setStyle(BASEMAP_STYLES[style].url);
    setActiveBasemap(style);
    localStorage.setItem(BASEMAP_STORAGE_KEY, style);
  }, [map, activeBasemap]);

  // Terrain state
  const terrain = useTerrain();

  // Drag and drop state
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // CFS layer toggles: layerId -> { active, visible }
  const [cfsLayerState, setCfsLayerState] = useState<Record<string, { active: boolean }>>({});
  const [cfsError, setCfsError] = useState<string | null>(null);
  const [cfsDate, setCfsDate] = useState<string>(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });

  const handleCFSLayerToggle = useCallback(async (layerId: string, layerName: string, wmsLayerName: string) => {
    const isActive = cfsLayerState[layerId]?.active ?? false;
    setCfsError(null);

    if (!isActive) {
      // Probe a single tile to check if WMS has data for this layer/date
      const tileUrl = cfs.buildWmsUrl(wmsLayerName, cfsDate);
      const probeTile = tileUrl.replace('{bbox-epsg-3857}', '-13775786,7514065,-13462822,7827030');
      try {
        const res = await fetch(probeTile, { method: 'HEAD' });
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.startsWith('image/')) {
          setCfsError(`No ${layerName} data available for ${cfsDate}`);
          return;
        }
      } catch {
        setCfsError(`Unable to reach CFS server for ${layerName}`);
        return;
      }

      addRasterLayer({
        id: layerId,
        name: layerName,
        url: tileUrl,
        tileSize: 256,
        opacity: 0.8,
        visible: true,
        zIndex: 999,
      });
      setCfsLayerState((prev) => ({ ...prev, [layerId]: { active: true } }));
    } else {
      // Remove layer
      removeLayer(layerId);
      setCfsLayerState((prev) => ({ ...prev, [layerId]: { active: false } }));
    }
  }, [cfsLayerState, cfs, cfsDate, addRasterLayer, removeLayer]);

  // CWFIS M3 layer toggles (#299): public, no key. Hotspots are season-filtered.
  const [cwfisLayerState, setCwfisLayerState] = useState<Record<string, { active: boolean }>>({});
  const [cwfisError, setCwfisError] = useState<string | null>(null);

  const handleCwfisLayerToggle = useCallback(async (layerId: string, layerName: string, wmsLayerName: string, temporal: boolean) => {
    const isActive = cwfisLayerState[layerId]?.active ?? false;
    setCwfisError(null);

    if (!isActive) {
      // Temporal layers (hotspots) are filtered to the current season; perimeters are static.
      const tileUrl = cwfis.buildWmsUrl(wmsLayerName, temporal ? { time: currentSeasonTime() } : undefined);
      const probeTile = tileUrl.replace('{bbox-epsg-3857}', '-13775786,7514065,-13462822,7827030');
      try {
        const res = await fetch(probeTile, { method: 'HEAD' });
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.startsWith('image/')) {
          setCwfisError(`No ${layerName} data available`);
          return;
        }
      } catch {
        setCwfisError(`Unable to reach CWFIS server for ${layerName}`);
        return;
      }

      addRasterLayer({
        id: layerId,
        name: layerName,
        url: tileUrl,
        tileSize: 256,
        opacity: 0.8,
        visible: true,
        zIndex: 999,
        legendType: 'wms',
        legendUrl: cwfis.buildLegendUrl(wmsLayerName),
      });
      setCwfisLayerState((prev) => ({ ...prev, [layerId]: { active: true } }));
    } else {
      removeLayer(layerId);
      setCwfisLayerState((prev) => ({ ...prev, [layerId]: { active: false } }));
    }
  }, [cwfisLayerState, cwfis, addRasterLayer, removeLayer]);

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

  // Collapsed toggle button for mobile
  if (isMobile && collapsed) {
    return (
      <button
        className={`layer-panel-toggle ${className}`}
        onClick={() => setCollapsed(false)}
        style={{
          position: 'absolute',
          zIndex: 1,
          ...POSITION_STYLES[position],
          backgroundColor: 'white',
          border: 'none',
          borderRadius: '4px',
          boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
          padding: '10px 12px',
          cursor: 'pointer',
          fontSize: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          color: '#333',
        }}
        aria-label="Open layers panel"
      >
        <i className="fa-solid fa-layer-group" />
        {state.layers.length > 0 && (
          <span style={{ fontSize: '12px', color: '#666' }}>{state.layers.length}</span>
        )}
      </button>
    );
  }

  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    zIndex: 1,
    backgroundColor: 'white',
    borderRadius: '4px',
    boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
    minWidth: isMobile ? '240px' : '280px',
    maxWidth: isMobile ? 'calc(100vw - 20px)' : '350px',
    maxHeight: isMobile ? 'calc(100vh - 120px)' : (cfs.available ? '550px' : '400px'),
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    ...POSITION_STYLES[position],
  };

  const cfsSectionStyle: React.CSSProperties = {
    borderTop: '1px solid #eee',
    padding: '8px',
  };

  const cfsSectionHeaderStyle: React.CSSProperties = {
    padding: '6px 8px',
    fontWeight: 600,
    fontSize: '12px',
    color: '#555',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  };

  const cfsLayerRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '4px 8px',
    fontSize: '13px',
  };

  const cfsDateRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '4px 8px',
    fontSize: '13px',
    color: '#555',
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
    gap: '8px',
  };

  const renderHeader = () => (
    <div style={headerStyle}>
      <span><i className="fa-solid fa-layer-group" style={{ marginRight: '8px' }} />Layers</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '12px', color: '#999' }}>{state.layers.length}</span>
        {isMobile && (
          <button
            onClick={() => setCollapsed(true)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#666', padding: '0 4px' }}
            aria-label="Close layers panel"
          >
            &times;
          </button>
        )}
      </div>
    </div>
  );

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

  /** CFS Layers section - only rendered when API key is configured */
  const CFSSection = cfs.available ? (
    <div style={cfsSectionStyle}>
      <div style={cfsSectionHeaderStyle}>
        <i className="fa-solid fa-satellite-dish" style={{ color: '#e63946' }} />
        CFS Layers
      </div>

      {/* Date picker for TIME parameter */}
      <div style={cfsDateRowStyle}>
        <label style={{ fontSize: '12px', color: '#666', minWidth: '36px' }}>Date:</label>
        <input
          type="date"
          value={cfsDate}
          onChange={(e) => setCfsDate(e.target.value)}
          style={{
            fontSize: '12px',
            padding: '2px 4px',
            border: '1px solid #ddd',
            borderRadius: '4px',
            flex: 1,
          }}
        />
      </div>

      {/* Data availability warning */}
      {cfsError && (
        <div style={{
          padding: '6px 8px',
          margin: '4px 8px',
          fontSize: '12px',
          color: '#92400e',
          backgroundColor: '#fef3c7',
          borderRadius: '4px',
          border: '1px solid #fcd34d',
        }}>
          {cfsError}
        </div>
      )}

      {/* Layer toggles */}
      {cfs.layers.map((layer) => {
        const isActive = cfsLayerState[layer.id]?.active ?? false;
        return (
          <div key={layer.id} style={cfsLayerRowStyle}>
            <input
              type="checkbox"
              id={`cfs-${layer.id}`}
              checked={isActive}
              onChange={() => handleCFSLayerToggle(layer.id, layer.name, layer.layerName)}
              style={{ cursor: 'pointer' }}
            />
            <label
              htmlFor={`cfs-${layer.id}`}
              style={{ cursor: 'pointer', flex: 1 }}
            >
              {layer.name}
            </label>
          </div>
        );
      })}
    </div>
  ) : null;

  /** CWFIS Live section (#299) — M3 hotspots + perimeters. Public service, always available. */
  const CwfisSection = cwfis.available ? (
    <div style={cfsSectionStyle}>
      <div style={cfsSectionHeaderStyle}>
        <i className="fa-solid fa-fire" style={{ color: '#ea580c' }} />
        CWFIS Live
      </div>

      {/* Current-season caption (hotspots are filtered Jan 1 -> today) */}
      <div style={{ ...cfsDateRowStyle, color: '#666', fontSize: '11px' }}>
        Hotspots: current season ({currentSeasonTime()})
      </div>

      {cwfisError && (
        <div style={{
          padding: '6px 8px',
          margin: '4px 8px',
          fontSize: '12px',
          color: '#92400e',
          backgroundColor: '#fef3c7',
          borderRadius: '4px',
          border: '1px solid #fcd34d',
        }}>
          {cwfisError}
        </div>
      )}

      {cwfis.layers.map((layer) => {
        const isActive = cwfisLayerState[layer.id]?.active ?? false;
        return (
          <div key={layer.id} style={cfsLayerRowStyle}>
            <input
              type="checkbox"
              id={`cwfis-${layer.id}`}
              checked={isActive}
              onChange={() => handleCwfisLayerToggle(layer.id, layer.name, layer.layerName, layer.temporal)}
              style={{ cursor: 'pointer' }}
            />
            <label htmlFor={`cwfis-${layer.id}`} style={{ cursor: 'pointer', flex: 1 }}>
              {layer.name}
            </label>
          </div>
        );
      })}
    </div>
  ) : null;

  /** Map Settings section — basemap + terrain */
  const sectionHeaderBase: React.CSSProperties = {
    padding: '6px 8px',
    fontWeight: 600,
    fontSize: '12px',
    color: '#555',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  };

  const basemapOptionStyle = (isActive: boolean): React.CSSProperties => ({
    padding: '6px 8px',
    fontSize: '13px',
    color: '#333',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    backgroundColor: isActive ? '#e3f2fd' : 'transparent',
    borderRadius: '4px',
  });

  const MapSettingsSection = (
    <div style={{ borderTop: '1px solid #eee', padding: '8px' }}>
      {/* Basemap */}
      <div style={sectionHeaderBase}>
        <i className="fa-solid fa-map" style={{ color: '#1976d2' }} />
        Basemap
      </div>
      {(Object.entries(BASEMAP_STYLES) as [BasemapStyle, { name: string; url: string }][]).map(([key, config]) => (
        <div
          key={key}
          style={basemapOptionStyle(key === activeBasemap)}
          onClick={() => handleBasemapChange(key)}
        >
          <i className={`fa-solid fa-${key === 'streets' ? 'road' : key === 'satellite' ? 'satellite' : 'mountain'}`}
            style={{ width: '16px', textAlign: 'center', color: '#666' }} />
          <span>{config.name}</span>
          {key === activeBasemap && <i className="fa-solid fa-check" style={{ marginLeft: 'auto', color: '#1976d2', fontSize: '12px' }} />}
        </div>
      ))}

      {/* 3D Terrain */}
      {terrain.isSupported && (
        <>
          <div style={{ ...sectionHeaderBase, marginTop: '8px' }}>
            <i className="fa-solid fa-mountain" style={{ color: '#4caf50' }} />
            3D Terrain
            <div
              style={{
                marginLeft: 'auto',
                width: '36px',
                height: '18px',
                backgroundColor: terrain.config.enabled ? '#4caf50' : '#ccc',
                borderRadius: '9px',
                cursor: 'pointer',
                position: 'relative',
                transition: 'background-color 0.2s',
              }}
              onClick={terrain.toggle}
            >
              <div style={{
                position: 'absolute',
                top: '2px',
                left: terrain.config.enabled ? '20px' : '2px',
                width: '14px',
                height: '14px',
                backgroundColor: 'white',
                borderRadius: '50%',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                transition: 'left 0.2s',
              }} />
            </div>
          </div>
          {terrain.config.enabled && (
            <div style={{ padding: '4px 8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#666' }}>
                <span>Exaggeration</span>
                <span>{terrain.config.exaggeration.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="1"
                max="3"
                step="0.1"
                value={terrain.config.exaggeration}
                onChange={(e) => terrain.setExaggeration(Number(e.target.value))}
                style={{ width: '100%', height: '4px', cursor: 'pointer' }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );

  if (state.layers.length === 0 && !cfs.available) {
    return (
      <div className={`layer-panel ${className}`} style={containerStyle}>
        {renderHeader()}
        <div style={emptyStyle}>
          No layers added yet
        </div>
        {MapSettingsSection}
      </div>
    );
  }

  if (state.layers.length === 0 && cfs.available) {
    return (
      <div className={`layer-panel ${className}`} style={containerStyle}>
        {renderHeader()}
        <div style={emptyStyle}>
          No layers added yet
        </div>
        {CFSSection}
        {CwfisSection}
        {MapSettingsSection}
      </div>
    );
  }

  return (
    <div className={`layer-panel ${className}`} style={containerStyle}>
      {renderHeader()}
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
            onToggleHover={layer.type === 'raster' && layer.legendType !== 'wms' ? () => {
              const newHover = !layer.hoverEnabled;
              updateLayer(layer.id, {
                hoverEnabled: newHover,
                opacity: newHover ? 1.0 : 0.8,
              });
            } : undefined}
            onDragStart={(e) => handleDragStart(e, layer.id)}
            onDragOver={(e) => handleDragOver(e, layer.id)}
            onDrop={(e) => handleDrop(e, layer.id)}
            onDragEnd={handleDragEnd}
          />
        ))}
      </div>
      {CFSSection}
      {CwfisSection}
      {MapSettingsSection}
    </div>
  );
}
