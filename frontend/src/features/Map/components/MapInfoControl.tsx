/**
 * Map Info Control
 *
 * Displays current cursor position (lat/lon), zoom level, and map direction/angle.
 * Positioned in bottom-right corner above attribution.
 */

import { useState, useEffect } from 'react';
import { useMap } from '../context/MapContext';

/**
 * MapInfoControl displays real-time map information
 */
export function MapInfoControl() {
  const { map, isLoaded } = useMap();
  const [cursorLat, setCursorLat] = useState<number | null>(null);
  const [cursorLng, setCursorLng] = useState<number | null>(null);
  const [zoom, setZoom] = useState<number>(0);
  const [bearing, setBearing] = useState<number>(0);
  const [pitch, setPitch] = useState<number>(0);

  useEffect(() => {
    if (!map || !isLoaded) return;

    // Initialize values
    setZoom(map.getZoom());
    setBearing(map.getBearing());
    setPitch(map.getPitch());

    // Track cursor position
    const handleMouseMove = (e: mapboxgl.MapMouseEvent) => {
      setCursorLat(e.lngLat.lat);
      setCursorLng(e.lngLat.lng);
    };

    const handleMouseLeave = () => {
      setCursorLat(null);
      setCursorLng(null);
    };

    // Track map view changes
    const handleMove = () => {
      setZoom(map.getZoom());
      setBearing(map.getBearing());
      setPitch(map.getPitch());
    };

    map.on('mousemove', handleMouseMove);
    map.on('mouseleave', handleMouseLeave);
    map.on('move', handleMove);

    return () => {
      map.off('mousemove', handleMouseMove);
      map.off('mouseleave', handleMouseLeave);
      map.off('move', handleMove);
    };
  }, [map, isLoaded]);

  // Format coordinates
  const formatCoord = (value: number | null, isLat: boolean): string => {
    if (value === null) return '--';
    const absValue = Math.abs(value);
    const dir = isLat ? (value >= 0 ? 'N' : 'S') : (value >= 0 ? 'E' : 'W');
    return `${absValue.toFixed(5)}° ${dir}`;
  };

  // Format bearing as compass direction
  const formatBearing = (deg: number): string => {
    const normalized = ((deg % 360) + 360) % 360;
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(normalized / 45) % 8;
    return `${normalized.toFixed(0)}° ${directions[index]}`;
  };

  return (
    <div style={containerStyle}>
      <div style={rowStyle}>
        <span style={labelStyle}>Lat:</span>
        <span style={valueStyle}>{formatCoord(cursorLat, true)}</span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>Lon:</span>
        <span style={valueStyle}>{formatCoord(cursorLng, false)}</span>
      </div>
      <div style={dividerStyle} />
      <div style={rowStyle}>
        <span style={labelStyle}>Zoom:</span>
        <span style={valueStyle}>{zoom.toFixed(1)}</span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>Dir:</span>
        <span style={valueStyle}>{formatBearing(bearing)}</span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>Tilt:</span>
        <span style={valueStyle}>{pitch.toFixed(0)}°</span>
      </div>
    </div>
  );
}

// Styles
const containerStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: '30px',
  right: '10px',
  backgroundColor: 'rgba(255, 255, 255, 0.95)',
  borderRadius: '4px',
  boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
  padding: '8px 12px',
  fontSize: '11px',
  fontFamily: 'monospace',
  zIndex: 1,
  minWidth: '140px',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '8px',
  lineHeight: '1.6',
};

const labelStyle: React.CSSProperties = {
  color: '#666',
  fontWeight: 500,
};

const valueStyle: React.CSSProperties = {
  color: '#333',
  textAlign: 'right',
};

const dividerStyle: React.CSSProperties = {
  height: '1px',
  backgroundColor: '#e0e0e0',
  margin: '4px 0',
};
