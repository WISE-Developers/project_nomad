import { useState } from 'react';
import { useMap } from '../context/MapContext';
import { BasemapStyle, BASEMAP_STYLES } from '../types';

/**
 * Props for BasemapSwitcher component
 */
interface BasemapSwitcherProps {
  /** Initial basemap style */
  initialStyle?: BasemapStyle;
  /** Position on the map */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** Callback when basemap changes */
  onChange?: (style: BasemapStyle) => void;
  /** CSS class for additional styling */
  className?: string;
}

/**
 * Local storage key for persisting basemap selection
 */
const STORAGE_KEY = 'nomad-basemap-style';

/**
 * Position style mapping
 */
const POSITION_STYLES: Record<string, React.CSSProperties> = {
  'top-left': { top: '10px', left: '10px' },
  'top-right': { top: '60px', right: '10px' },
  'bottom-left': { bottom: '150px', left: '10px' },
  'bottom-right': { bottom: '150px', right: '10px' },
};

/**
 * BasemapSwitcher provides UI for switching between map styles.
 *
 * Supports three basemap options:
 * - Streets: Standard street map
 * - Satellite: Satellite imagery with labels
 * - Outdoors: Terrain/topographic map
 *
 * Persists selection in localStorage.
 *
 * @example
 * ```tsx
 * <MapContainer>
 *   <BasemapSwitcher
 *     position="bottom-right"
 *     onChange={(style) => console.log('Switched to:', style)}
 *   />
 * </MapContainer>
 * ```
 */
export function BasemapSwitcher({
  initialStyle,
  position = 'bottom-right',
  onChange,
  className = '',
}: BasemapSwitcherProps) {
  const { map } = useMap();
  const [activeStyle, setActiveStyle] = useState<BasemapStyle>(() => {
    if (initialStyle) return initialStyle;
    const stored = localStorage.getItem(STORAGE_KEY);
    return (stored as BasemapStyle) || 'outdoors';
  });
  const [isOpen, setIsOpen] = useState(false);

  // Note: Initial style is now applied in MapContainer from localStorage
  // This component only handles user-initiated style changes

  const handleStyleChange = (style: BasemapStyle) => {
    if (!map || style === activeStyle) {
      setIsOpen(false);
      return;
    }

    map.setStyle(BASEMAP_STYLES[style].url);
    setActiveStyle(style);
    localStorage.setItem(STORAGE_KEY, style);
    setIsOpen(false);
    onChange?.(style);
  };

  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    zIndex: 1,
    ...POSITION_STYLES[position],
  };

  const buttonStyle: React.CSSProperties = {
    backgroundColor: 'white',
    border: 'none',
    borderRadius: '4px',
    boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
    padding: '8px 12px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    fontWeight: 500,
    color: '#333',
  };

  const dropdownStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: '100%',
    right: 0,
    marginBottom: '4px',
    backgroundColor: 'white',
    borderRadius: '4px',
    boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
    overflow: 'hidden',
    minWidth: '150px',
  };

  const optionStyle: React.CSSProperties = {
    padding: '10px 16px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    color: '#333',
    borderBottom: '1px solid #eee',
  };

  const activeOptionStyle: React.CSSProperties = {
    ...optionStyle,
    backgroundColor: '#e3f2fd',
    fontWeight: 500,
  };

  const styleIcons: Record<BasemapStyle, React.ReactNode> = {
    streets: <i className="fa-solid fa-road" />,
    satellite: <i className="fa-solid fa-satellite" />,
    outdoors: <i className="fa-solid fa-mountain" />,
  };

  return (
    <div className={`basemap-switcher ${className}`} style={containerStyle}>
      {isOpen && (
        <div style={dropdownStyle}>
          {Object.entries(BASEMAP_STYLES).map(([key, config]) => (
            <div
              key={key}
              style={key === activeStyle ? activeOptionStyle : optionStyle}
              onClick={() => handleStyleChange(key as BasemapStyle)}
            >
              <span>{styleIcons[key as BasemapStyle]}</span>
              <span>{config.name}</span>
              {key === activeStyle && <i className="fa-solid fa-check" />}
            </div>
          ))}
        </div>
      )}
      <button
        style={buttonStyle}
        onClick={() => setIsOpen(!isOpen)}
        title="Change basemap"
      >
        <span>{styleIcons[activeStyle]}</span>
        <span>{BASEMAP_STYLES[activeStyle].name}</span>
        <span style={{ fontSize: '10px' }}>{isOpen ? '▲' : '▼'}</span>
      </button>
    </div>
  );
}
