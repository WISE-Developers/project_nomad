/**
 * Map Context Menu
 *
 * Right-click / long-press context menu for the map.
 * Shows captured lat/lon, zoom, angle with copy buttons,
 * plus placeholder function buttons.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useMap } from '../context/MapContext';

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  lat: number;
  lng: number;
  zoom: number;
  bearing: number;
  pitch: number;
}

const initialState: ContextMenuState = {
  visible: false,
  x: 0,
  y: 0,
  lat: 0,
  lng: 0,
  zoom: 0,
  bearing: 0,
  pitch: 0,
};

/**
 * MapContextMenu provides right-click functionality on the map
 */
export function MapContextMenu() {
  const { map, isLoaded } = useMap();
  const [menu, setMenu] = useState<ContextMenuState>(initialState);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Copy to clipboard
  const copyToClipboard = useCallback(async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, []);

  // Close menu
  const closeMenu = useCallback(() => {
    setMenu((prev) => ({ ...prev, visible: false }));
  }, []);

  // Handle context menu (right-click)
  const handleContextMenu = useCallback(
    (e: mapboxgl.MapMouseEvent & { originalEvent: MouseEvent }) => {
      e.originalEvent.preventDefault();

      if (!map) return;

      setMenu({
        visible: true,
        x: e.originalEvent.clientX,
        y: e.originalEvent.clientY,
        lat: e.lngLat.lat,
        lng: e.lngLat.lng,
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      });
    },
    [map]
  );

  // Handle touch start (for long press)
  const handleTouchStart = useCallback(
    (e: mapboxgl.MapTouchEvent) => {
      if (!map) return;

      const touch = e.originalEvent.touches[0];
      const lngLat = e.lngLat;

      longPressTimer.current = setTimeout(() => {
        setMenu({
          visible: true,
          x: touch.clientX,
          y: touch.clientY,
          lat: lngLat.lat,
          lng: lngLat.lng,
          zoom: map.getZoom(),
          bearing: map.getBearing(),
          pitch: map.getPitch(),
        });
      }, 500); // 500ms long press
    },
    [map]
  );

  // Cancel long press on touch end/move
  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  useEffect(() => {
    if (!map || !isLoaded) return;

    map.on('contextmenu', handleContextMenu);
    map.on('touchstart', handleTouchStart);
    map.on('touchend', handleTouchEnd);
    map.on('touchmove', handleTouchEnd);

    // Close menu on click elsewhere
    const handleClick = () => closeMenu();
    map.on('click', handleClick);

    // Close on escape
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      map.off('contextmenu', handleContextMenu);
      map.off('touchstart', handleTouchStart);
      map.off('touchend', handleTouchEnd);
      map.off('touchmove', handleTouchEnd);
      map.off('click', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [map, isLoaded, handleContextMenu, handleTouchStart, handleTouchEnd, closeMenu]);

  if (!menu.visible) return null;

  // Format values
  const formatCoord = (value: number, isLat: boolean): string => {
    const absValue = Math.abs(value);
    const dir = isLat ? (value >= 0 ? 'N' : 'S') : (value >= 0 ? 'E' : 'W');
    return `${absValue.toFixed(6)}° ${dir}`;
  };

  const formatBearing = (deg: number): string => {
    const normalized = ((deg % 360) + 360) % 360;
    return `${normalized.toFixed(1)}°`;
  };

  // Placeholder function handlers
  const handleFunction1 = () => {
    console.log('Function 1 clicked at:', menu.lat, menu.lng);
    closeMenu();
  };

  const handleFunction2 = () => {
    console.log('Function 2 clicked at:', menu.lat, menu.lng);
    closeMenu();
  };

  const handleFunction3 = () => {
    console.log('Function 3 clicked at:', menu.lat, menu.lng);
    closeMenu();
  };

  // Position menu (ensure it stays within viewport)
  const menuStyle: React.CSSProperties = {
    ...baseMenuStyle,
    left: Math.min(menu.x, window.innerWidth - 220),
    top: Math.min(menu.y, window.innerHeight - 350),
  };

  return (
    <>
      {/* Backdrop to catch clicks */}
      <div style={backdropStyle} onClick={closeMenu} />

      {/* Context menu */}
      <div style={menuStyle}>
        <div style={headerStyle}>Map Position</div>

        {/* Coordinates section */}
        <div style={sectionStyle}>
          <CopyableRow
            label="Latitude"
            value={formatCoord(menu.lat, true)}
            rawValue={menu.lat.toFixed(6)}
            onCopy={copyToClipboard}
            copied={copiedField === 'lat'}
            field="lat"
          />
          <CopyableRow
            label="Longitude"
            value={formatCoord(menu.lng, false)}
            rawValue={menu.lng.toFixed(6)}
            onCopy={copyToClipboard}
            copied={copiedField === 'lng'}
            field="lng"
          />
          <CopyableRow
            label="Lat, Lng"
            value={`${menu.lat.toFixed(6)}, ${menu.lng.toFixed(6)}`}
            rawValue={`${menu.lat.toFixed(6)}, ${menu.lng.toFixed(6)}`}
            onCopy={copyToClipboard}
            copied={copiedField === 'latlng'}
            field="latlng"
          />
        </div>

        <div style={dividerStyle} />

        {/* View section */}
        <div style={sectionStyle}>
          <CopyableRow
            label="Zoom"
            value={menu.zoom.toFixed(2)}
            rawValue={menu.zoom.toFixed(2)}
            onCopy={copyToClipboard}
            copied={copiedField === 'zoom'}
            field="zoom"
          />
          <CopyableRow
            label="Bearing"
            value={formatBearing(menu.bearing)}
            rawValue={menu.bearing.toFixed(1)}
            onCopy={copyToClipboard}
            copied={copiedField === 'bearing'}
            field="bearing"
          />
          <CopyableRow
            label="Tilt"
            value={`${menu.pitch.toFixed(1)}°`}
            rawValue={menu.pitch.toFixed(1)}
            onCopy={copyToClipboard}
            copied={copiedField === 'tilt'}
            field="tilt"
          />
        </div>

        <div style={dividerStyle} />

        {/* Functions section */}
        <div style={sectionStyle}>
          <div style={sectionHeaderStyle}>Actions</div>
          <button style={functionButtonStyle} onClick={handleFunction1}>
            Function 1
          </button>
          <button style={functionButtonStyle} onClick={handleFunction2}>
            Function 2
          </button>
          <button style={functionButtonStyle} onClick={handleFunction3}>
            Function 3
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * Row with copy button
 */
interface CopyableRowProps {
  label: string;
  value: string;
  rawValue: string;
  onCopy: (text: string, field: string) => void;
  copied: boolean;
  field: string;
}

function CopyableRow({ label, value, rawValue, onCopy, copied, field }: CopyableRowProps) {
  return (
    <div style={rowStyle}>
      <span style={rowLabelStyle}>{label}</span>
      <span style={rowValueStyle}>{value}</span>
      <button
        style={copyButtonStyle}
        onClick={() => onCopy(rawValue, field)}
        title={copied ? 'Copied!' : 'Copy to clipboard'}
      >
        <i className={`fa-solid ${copied ? 'fa-check' : 'fa-clipboard'}`} />
      </button>
    </div>
  );
}

// Styles
const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 999,
};

const baseMenuStyle: React.CSSProperties = {
  position: 'fixed',
  backgroundColor: 'white',
  borderRadius: '8px',
  boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
  padding: '12px',
  zIndex: 1000,
  minWidth: '200px',
  fontSize: '13px',
};

const headerStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: '14px',
  color: '#333',
  marginBottom: '12px',
  paddingBottom: '8px',
  borderBottom: '1px solid #e0e0e0',
};

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
};

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  color: '#666',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  marginBottom: '4px',
};

const dividerStyle: React.CSSProperties = {
  height: '1px',
  backgroundColor: '#e0e0e0',
  margin: '10px 0',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};

const rowLabelStyle: React.CSSProperties = {
  color: '#666',
  minWidth: '70px',
  fontSize: '12px',
};

const rowValueStyle: React.CSSProperties = {
  flex: 1,
  color: '#333',
  fontFamily: 'monospace',
  fontSize: '12px',
};

const copyButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '4px',
  fontSize: '14px',
  opacity: 0.6,
  borderRadius: '4px',
  transition: 'opacity 0.2s, background-color 0.2s',
};

const functionButtonStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: '13px',
  backgroundColor: '#f5f5f5',
  border: '1px solid #e0e0e0',
  borderRadius: '4px',
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'background-color 0.2s',
};
