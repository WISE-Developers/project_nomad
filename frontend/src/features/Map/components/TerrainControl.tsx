import { useTerrain } from '../hooks/useTerrain';

/**
 * Props for TerrainControl component
 */
interface TerrainControlProps {
  /** Position on the map */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** CSS class for additional styling */
  className?: string;
}

/**
 * Position style mapping
 */
const POSITION_STYLES: Record<string, React.CSSProperties> = {
  'top-left': { top: '10px', left: '10px' },
  'top-right': { top: '10px', right: '50px' }, // Leave space for zoom controls on the right
  'bottom-left': { bottom: '30px', left: '10px' },
  'bottom-right': { bottom: '80px', right: '10px' },
};

/**
 * TerrainControl provides UI for 3D terrain visualization.
 *
 * Features:
 * - Toggle 3D terrain on/off
 * - Adjust terrain exaggeration (1x - 3x)
 * - Settings persisted in localStorage
 *
 * @example
 * ```tsx
 * <MapContainer>
 *   <TerrainControl position="top-right" />
 * </MapContainer>
 * ```
 */
export function TerrainControl({
  position = 'top-right',
  className = '',
}: TerrainControlProps) {
  const { config, toggle, setExaggeration, isSupported } = useTerrain();

  if (!isSupported) {
    return null;
  }

  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    zIndex: 1,
    backgroundColor: 'white',
    borderRadius: '4px',
    boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
    padding: '8px',
    minWidth: '310px',
    ...POSITION_STYLES[position],
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: config.enabled ? '8px' : 0,
  };

  const labelStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    fontWeight: 500,
    color: '#333',
  };

  const toggleStyle: React.CSSProperties = {
    position: 'relative',
    width: '40px',
    height: '20px',
    backgroundColor: config.enabled ? '#4caf50' : '#ccc',
    borderRadius: '10px',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  };

  const toggleKnobStyle: React.CSSProperties = {
    position: 'absolute',
    top: '2px',
    left: config.enabled ? '22px' : '2px',
    width: '16px',
    height: '16px',
    backgroundColor: 'white',
    borderRadius: '50%',
    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
    transition: 'left 0.2s',
  };

  const sliderContainerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  };

  const sliderLabelStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '12px',
    color: '#666',
  };

  const sliderStyle: React.CSSProperties = {
    width: '100%',
    height: '4px',
    cursor: 'pointer',
  };

  return (
    <div className={`terrain-control ${className}`} style={containerStyle}>
      <div style={headerStyle}>
        <div style={labelStyle}>
          <i className="fa-solid fa-mountain" />
          <span>3D Terrain</span>
        </div>
        <div style={toggleStyle} onClick={toggle}>
          <div style={toggleKnobStyle} />
        </div>
      </div>

      {config.enabled && (
        <div style={sliderContainerStyle}>
          <div style={sliderLabelStyle}>
            <span>Exaggeration</span>
            <span>{config.exaggeration.toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min="1"
            max="3"
            step="0.1"
            value={config.exaggeration}
            onChange={(e) => setExaggeration(Number(e.target.value))}
            style={sliderStyle}
          />
          <div style={{ ...sliderLabelStyle, fontSize: '10px', color: '#999' }}>
            <span>Subtle</span>
            <span>Dramatic</span>
          </div>
        </div>
      )}
    </div>
  );
}
